// Unified Order Engine (PRD §105). Semua channel — POS, QR, web, kiosk —
// membuat order lewat createOrder; pembayaran, antrean, dan status produksi
// juga hanya bisa berubah lewat fungsi di file ini.
//
// Prinsip:
// - Harga selalu dihitung ulang dari DB (catalog/storefront + quote).
// - Operasi yang harus atomik memakai transaksi + row lock.
// - Nomor antrean hanya terbit saat pembayaran dikonfirmasi.
// - Order belum dibayar kedaluwarsa (expires_at = now() DB + TTL outlet);
//   pembatalan massal oleh pg_cron → public.expire_pending_orders.
// - Stok produk jadi dipotong saat order dibayar (ledger inventory), dan
//   dikembalikan lewat reversal bila pembatalan order lunas disetujui.
// - Setiap perubahan dicatat di audit log dan disiarkan sebagai sinyal
//   realtime tanpa data (realtime.send di dalam transaksi → hanya terkirim
//   bila commit).

import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { Database, DbExecutor } from "@/db/client";
import {
  approvals,
  auditLogs,
  orderItemModifiers,
  orderItems,
  orderNumberCounters,
  orders,
  outlets,
  payments,
  users,
} from "@/db/schema";
import { recordAudit, type AuditContext } from "@/lib/audit";
import { listAccessibleOutlets, type CurrentUser } from "@/lib/auth/access";
import { AccessError } from "@/lib/auth/errors";
import { hasPermission } from "@/lib/auth/policy";
import type { Permission } from "@/lib/auth/rbac";
import { quoteCart, type CartQuoteLine } from "@/lib/catalog/quote";
import { loadStorefront } from "@/lib/catalog/storefront";
import { formatRupiah } from "@/lib/format";
import { crossedZero, postSaleMovements, reverseSaleMovements } from "@/lib/inventory/ledger";
import { qtyToString } from "@/lib/inventory/units";
import { getOnlinePaymentProvider } from "@/lib/payments/provider";

import { REALTIME_EVENT, guestOrderTopic, outletOrdersTopic } from "./realtime";
import { PUBLIC_CHANNELS, checkoutInput, requireCustomerName } from "./schemas";
import {
  ACTIVE_QUEUE_STATUSES,
  TERMINAL_STATUSES,
  formatOrderNumber,
  orderReference,
  transitionKind,
  type OrderChannel,
  type OrderStatus,
  type PaymentStatus,
} from "./state";
import { createAccessToken, verifyAccessToken } from "./tokens";

const ORDER_STATUSES = [
  "draft",
  "pending_payment",
  "paid",
  "queued",
  "preparing",
  "ready",
  "completed",
  "cancelled",
  "refunded",
] as const satisfies readonly OrderStatus[];

const notFound = () => new AccessError("not_found", "Pesanan tidak ditemukan.");
const forbidden = () => new AccessError("forbidden", "Anda tidak memiliki izin untuk tindakan ini.");

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AccessError("invalid", result.error.issues[0]?.message ?? "Input tidak valid.");
  }
  return result.data;
}

function assertAt(actor: CurrentUser, permission: Permission, outletId: string) {
  if (!actor.isActive || !hasPermission(actor, permission, { outletId })) throw forbidden();
}

/** Sinyal realtime tanpa data; ikut transaksi (terkirim hanya jika commit). */
async function notify(tx: DbExecutor, topics: string[]) {
  for (const topic of topics) {
    await tx.execute(sql`select realtime.send('{}'::jsonb, ${REALTIME_EVENT}, ${topic}, false)`);
  }
}

function topicsFor(order: { outletId: string; accessTokenHash: string | null }) {
  const topics = [outletOrdersTopic(order.outletId)];
  if (order.accessTokenHash) topics.push(guestOrderTopic(order.accessTokenHash));
  return topics;
}

const outletColumns = {
  id: outlets.id,
  code: outlets.code,
  name: outlets.name,
  companyId: outlets.companyId,
  brandId: outlets.brandId,
  timezone: outlets.timezone,
  orderNumberPrefix: outlets.orderNumberPrefix,
  pendingPaymentTtlMinutes: outlets.pendingPaymentTtlMinutes,
  isActive: outlets.isActive,
};

async function loadOutlet(db: DbExecutor, where: SQL) {
  const [outlet] = await db.select(outletColumns).from(outlets).where(where).limit(1);
  return outlet ?? null;
}

/** Outlet yang boleh diakses actor untuk permission tertentu. */
export async function outletsWithPermission(
  db: DbExecutor,
  actor: CurrentUser,
  permission: Permission,
) {
  const accessible = await listAccessibleOutlets(db, actor);
  return accessible.filter((o) => hasPermission(actor, permission, { outletId: o.id }));
}

// --- Membuat order ---------------------------------------------------------------

export type CreatedOrder = {
  orderId: string;
  reference: string;
  total: number;
  /** true = request ulang dengan idempotency key yang sama. */
  replayed: boolean;
  /** Token guest (hanya channel publik) — untuk cookie, jangan di-log. */
  accessToken: string | null;
};

type PricedLine = Extract<CartQuoteLine, { ok: true }>;

export async function createOrder(
  db: Database,
  params: {
    channel: OrderChannel;
    outlet: { code: string } | { id: string };
    actor: CurrentUser | null;
    input: unknown;
  },
  context: AuditContext,
): Promise<CreatedOrder> {
  const input = parse(checkoutInput, params.input);
  const { channel, actor } = params;
  const isPos = channel === "pos";

  if (isPos && !actor) throw new AccessError("unauthenticated", "Sesi berakhir. Silakan login ulang.");
  if (!isPos && !(PUBLIC_CHANNELS as readonly string[]).includes(channel)) {
    throw new AccessError("invalid", "Channel tidak valid.");
  }
  if (!isPos) {
    const nameError = requireCustomerName(input);
    if (nameError) throw new AccessError("invalid", nameError);
  }
  if (input.paymentMethod !== "cash" && !getOnlinePaymentProvider()) {
    throw new AccessError("invalid", "Pembayaran online belum tersedia. Silakan pilih tunai.");
  }

  const outlet =
    "id" in params.outlet
      ? await loadOutlet(db, eq(outlets.id, parse(z.uuid(), params.outlet.id)))
      : await loadOutlet(db, eq(outlets.code, params.outlet.code.trim().toUpperCase()));
  if (!outlet || !outlet.isActive) {
    throw new AccessError("invalid", "Outlet tidak ditemukan atau sedang tutup.");
  }
  if (isPos) {
    if (outlet.companyId !== actor!.company.id) throw notFound();
    assertAt(actor!, "order.create", outlet.id);
  }

  // PRD §100: validasi ulang produk, ketersediaan, & modifier dari DB.
  const storefront = await loadStorefront(db, outlet.code, { withStock: true });
  if (!storefront) throw new AccessError("invalid", "Outlet tidak ditemukan atau sedang tutup.");
  const quote = quoteCart(storefront, input.lines);
  if (!quote.ok) throw new AccessError("invalid", quote.error);
  const failed = quote.lines.find((line) => !line.ok);
  if (failed && !failed.ok) {
    throw new AccessError("invalid", failed.name ? `${failed.name}: ${failed.error}` : failed.error);
  }
  const lines = quote.lines as PricedLine[];
  const subtotal = quote.total;
  const token = isPos ? null : createAccessToken();

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(orders)
      .values({
        companyId: outlet.companyId,
        brandId: outlet.brandId,
        outletId: outlet.id,
        channel,
        type: input.type,
        status: "pending_payment",
        paymentStatus: "pending",
        idempotencyKey: input.idempotencyKey,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        tableNumber: input.type === "dine_in" ? input.tableNumber : null,
        deliveryAddress: input.type === "delivery" ? input.deliveryAddress : null,
        notes: input.notes,
        subtotal,
        discountTotal: 0,
        total: subtotal,
        accessTokenHash: token?.hash ?? null,
        // Waktu database, bukan jam perangkat/server aplikasi.
        expiresAt: sql`now() + make_interval(mins => ${outlet.pendingPaymentTtlMinutes}::int)`,
        createdBy: actor?.id ?? null,
      })
      .onConflictDoNothing({ target: [orders.outletId, orders.idempotencyKey] })
      .returning({ id: orders.id });

    if (!inserted) {
      // PRD §102: request yang sama (double click / retry) → order yang sama.
      const [existing] = await tx
        .select({ id: orders.id, total: orders.total, channel: orders.channel })
        .from(orders)
        .where(and(eq(orders.outletId, outlet.id), eq(orders.idempotencyKey, input.idempotencyKey)))
        .limit(1);
      let accessToken: string | null = null;
      if (token && existing.channel !== "pos") {
        // Token lama tidak disimpan; terbitkan ulang untuk client yang retry.
        await tx.update(orders).set({ accessTokenHash: token.hash }).where(eq(orders.id, existing.id));
        accessToken = token.token;
      }
      return {
        orderId: existing.id,
        reference: orderReference(existing.id),
        total: existing.total,
        replayed: true,
        accessToken,
      };
    }

    const orderId = inserted.id;
    // Id item dibuat di sini agar item & modifier bisa di-insert sekaligus
    // (lebih sedikit round-trip ke database).
    const itemRows = lines.map((line, index) => ({
      id: randomUUID(),
      orderId,
      productId: line.productId,
      productName: line.name,
      unitPrice: line.basePrice,
      quantity: line.quantity,
      modifiersTotal: line.unitPrice - line.basePrice,
      lineTotal: line.lineTotal,
      notes: input.lines[index].notes,
    }));
    await tx.insert(orderItems).values(itemRows);
    const modifierRows = lines.flatMap((line, index) =>
      line.modifiers.map((m) => ({
        orderItemId: itemRows[index].id,
        modifierId: m.modifierId,
        groupName: m.groupName,
        modifierName: m.name,
        priceDelta: m.priceDelta,
      })),
    );
    if (modifierRows.length) await tx.insert(orderItemModifiers).values(modifierRows);

    await tx.insert(payments).values({
      companyId: outlet.companyId,
      brandId: outlet.brandId,
      outletId: outlet.id,
      orderId,
      method: input.paymentMethod,
      status: "pending",
      amount: subtotal,
      createdBy: actor?.id ?? null,
    });

    await recordAudit(
      tx,
      {
        companyId: outlet.companyId,
        brandId: outlet.brandId,
        outletId: outlet.id,
        actorId: actor?.id ?? null,
        action: "order.created",
        entityType: "order",
        entityId: orderId,
        after: {
          channel,
          type: input.type,
          total: subtotal,
          items: lines.reduce((sum, l) => sum + l.quantity, 0),
          paymentMethod: input.paymentMethod,
        },
      },
      context,
    );
    await notify(tx, [outletOrdersTopic(outlet.id)]);

    return {
      orderId,
      reference: orderReference(orderId),
      total: subtotal,
      replayed: false,
      accessToken: token?.token ?? null,
    };
  });
}

// --- Pembayaran & antrean -------------------------------------------------------------

async function loadOrderForStaff(db: DbExecutor, actor: CurrentUser, orderId: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.companyId, actor.company.id)))
    .limit(1);
  if (!order) throw notFound();
  return order;
}

export const confirmCashInput = z.object({
  orderId: z.uuid(),
  tenderedAmount: z.coerce
    .number({ error: "Uang diterima harus angka." })
    .int({ error: "Uang diterima harus bilangan bulat." })
    .min(0)
    .max(100_000_000),
});

/** Hasil konfirmasi pembayaran. `menuBrandId` terisi bila sold out menu berubah. */
export type ConfirmedPayment = {
  orderNumber: string | null;
  change: number | null;
  alreadyPaid: boolean;
  menuBrandId: string | null;
};

const EXPIRED_MESSAGE =
  "Batas waktu pembayaran pesanan ini sudah habis, pesanan dibatalkan otomatis. Buat pesanan baru.";

/**
 * Kasir mengonfirmasi uang tunai sudah diterima (PRD §43). Idempotent:
 * order yang sudah lunas tidak mendapat nomor antrean kedua.
 *
 * Race dengan kedaluwarsa: baris order dikunci di sini; fungsi expiry
 * memakai SKIP LOCKED, jadi hanya salah satu yang menang. Order yang sudah
 * lewat expires_at (waktu DB) ditolak dan langsung dikedaluwarsakan.
 */
export async function confirmCashPayment(
  db: Database,
  actor: CurrentUser,
  raw: unknown,
  context: AuditContext,
): Promise<ConfirmedPayment> {
  const input = parse(confirmCashInput, raw);
  const order = await loadOrderForStaff(db, actor, input.orderId);
  assertAt(actor, "payment.confirm_cash", order.outletId);

  const result = await db.transaction(async (tx) => {
    // Kunci baris order: pembayaran bersamaan untuk order yang sama antre di sini.
    const [locked] = await tx
      .select({
        ...getTableColumns(orders),
        isExpired: sql<boolean>`${orders.expiresAt} is not null and ${orders.expiresAt} <= now()`,
      })
      .from(orders)
      .where(eq(orders.id, order.id))
      .for("update");
    if (locked.paymentStatus === "paid") {
      return { orderNumber: locked.orderNumber, change: null, alreadyPaid: true, menuBrandId: null };
    }
    if (locked.status === "pending_payment" && locked.isExpired) {
      // Commit pembatalan otomatis (fungsi yang sama dengan pg_cron), lalu tolak.
      await tx.execute(sql`select public.expire_pending_orders(1, ${locked.id}::uuid)`);
      return "expired" as const;
    }
    if (locked.status !== "pending_payment") {
      throw new AccessError(
        "conflict",
        locked.paymentStatus === "expired" ? EXPIRED_MESSAGE : "Pesanan ini tidak sedang menunggu pembayaran.",
      );
    }
    if (input.tenderedAmount < locked.total) {
      throw new AccessError(
        "invalid",
        `Uang diterima kurang dari total ${formatRupiah(locked.total)}.`,
      );
    }

    // Potong stok produk jadi lebih dulu: stok kurang → seluruh pembayaran
    // dibatalkan (rollback), uang tidak dianggap diterima.
    const sales = await postSaleMovements(tx, {
      orderId: locked.id,
      outletId: locked.outletId,
      actorId: actor.id,
    });

    const outlet = (await loadOutlet(tx, eq(outlets.id, locked.outletId)))!;
    // Counter harian per outlet. Upsert mengunci baris counter sehingga
    // transaksi bersamaan mendapat nomor berurutan & tidak pernah sama.
    const [counter] = await tx
      .insert(orderNumberCounters)
      .values({
        outletId: outlet.id,
        businessDate: sql`(clock_timestamp() at time zone ${outlet.timezone})::date`,
        lastNumber: 1,
      })
      .onConflictDoUpdate({
        target: [orderNumberCounters.outletId, orderNumberCounters.businessDate],
        set: { lastNumber: sql`${orderNumberCounters.lastNumber} + 1` },
      })
      .returning({
        businessDate: orderNumberCounters.businessDate,
        lastNumber: orderNumberCounters.lastNumber,
      });

    const orderNumber = formatOrderNumber(outlet.orderNumberPrefix, counter.lastNumber);
    const change = input.tenderedAmount - locked.total;
    // clock_timestamp() diambil SETELAH lock counter → urutan paid_at sama
    // dengan urutan nomor antrean (deterministik).
    const paidAt = sql`clock_timestamp()`;

    const updatedPayments = await tx
      .update(payments)
      .set({
        method: "cash",
        status: "paid",
        tenderedAmount: input.tenderedAmount,
        changeAmount: change,
        paidAt,
        confirmedBy: actor.id,
      })
      .where(and(eq(payments.orderId, locked.id), eq(payments.status, "pending")))
      .returning({ id: payments.id });
    if (updatedPayments.length === 0) {
      await tx.insert(payments).values({
        companyId: locked.companyId,
        brandId: locked.brandId,
        outletId: locked.outletId,
        orderId: locked.id,
        method: "cash",
        status: "paid",
        amount: locked.total,
        tenderedAmount: input.tenderedAmount,
        changeAmount: change,
        paidAt,
        confirmedBy: actor.id,
        createdBy: actor.id,
      });
    }

    await tx
      .update(orders)
      .set({
        status: "queued",
        paymentStatus: "paid",
        paidAt,
        businessDate: counter.businessDate,
        queueNumber: counter.lastNumber,
        orderNumber,
      })
      .where(eq(orders.id, locked.id));

    const base = {
      companyId: locked.companyId,
      brandId: locked.brandId,
      outletId: locked.outletId,
      actorId: actor.id,
      entityType: "order",
      entityId: locked.id,
    };
    await recordAudit(
      tx,
      {
        ...base,
        action: "payment.confirmed",
        after: { method: "cash", amount: locked.total, tendered: input.tenderedAmount, change },
      },
      context,
    );
    await recordAudit(
      tx,
      {
        ...base,
        action: "order.queued",
        before: { status: locked.status },
        after: { status: "queued", orderNumber, businessDate: counter.businessDate },
      },
      context,
    );
    if (sales.length) {
      await recordAudit(
        tx,
        {
          ...base,
          action: "inventory.sale_posted",
          after: {
            orderNumber,
            items: sales.map((m) => ({
              itemId: m.itemId,
              name: m.name,
              before: qtyToString(m.before),
              after: qtyToString(m.after),
            })),
          },
        },
        context,
      );
    }
    await notify(tx, topicsFor(locked));

    return {
      orderNumber,
      change,
      alreadyPaid: false,
      menuBrandId: sales.some(crossedZero) ? locked.brandId : null,
    };
  });

  if (result === "expired") throw new AccessError("conflict", EXPIRED_MESSAGE);
  return result;
}


// --- Status produksi (KDS) -------------------------------------------------------------

export const statusChangeInput = z.object({
  orderId: z.uuid(),
  /** Status yang dilihat user — mencegah double click menggeser dua langkah. */
  from: z.enum(ORDER_STATUSES),
  to: z.enum(ORDER_STATUSES),
});

const STATUS_TIMESTAMPS = {
  preparing: "preparingAt",
  ready: "readyAt",
  completed: "completedAt",
} as const;

export async function updateOrderStatus(
  db: Database,
  actor: CurrentUser,
  raw: unknown,
  context: AuditContext,
) {
  const input = parse(statusChangeInput, raw);
  const order = await loadOrderForStaff(db, actor, input.orderId);
  assertAt(actor, "order.update_status", order.outletId);

  const kind = transitionKind(input.from, input.to);
  if (!kind) throw new AccessError("invalid", "Perubahan status ini tidak diizinkan.");
  if (kind === "override") assertAt(actor, "kds.manage", order.outletId);

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(orders).where(eq(orders.id, order.id)).for("update");
    if (locked.status !== input.from) {
      throw new AccessError("conflict", "Status pesanan sudah berubah. Tampilan dimuat ulang.");
    }
    if (locked.paymentStatus !== "paid") {
      throw new AccessError("conflict", "Pesanan belum dibayar.");
    }

    const set: Partial<typeof orders.$inferInsert> = { status: input.to };
    if (kind === "normal") {
      const column = STATUS_TIMESTAMPS[input.to as keyof typeof STATUS_TIMESTAMPS];
      if (column) Object.assign(set, { [column]: sql`clock_timestamp()` });
    } else {
      // Mundur: hapus timestamp tahap yang dibatalkan.
      const column = STATUS_TIMESTAMPS[input.from as keyof typeof STATUS_TIMESTAMPS];
      if (column) Object.assign(set, { [column]: null });
    }
    await tx.update(orders).set(set).where(eq(orders.id, locked.id));

    await recordAudit(
      tx,
      {
        companyId: locked.companyId,
        brandId: locked.brandId,
        outletId: locked.outletId,
        actorId: actor.id,
        action: kind === "override" ? "order.status_override" : `order.${input.to}`,
        entityType: "order",
        entityId: locked.id,
        before: { status: input.from },
        after: { status: input.to, orderNumber: locked.orderNumber },
      },
      context,
    );
    await notify(tx, topicsFor(locked));
    return { status: input.to };
  });
}

// --- Pembatalan (PRD §48) ------------------------------------------------------------------

export const cancelInput = z.object({
  orderId: z.uuid(),
  reason: z
    .string({ error: "Alasan wajib diisi." })
    .trim()
    .min(3, { error: "Alasan minimal 3 karakter." })
    .max(300),
});

/**
 * Order belum dibayar → langsung dibatalkan. Order sudah dibayar → hanya
 * diajukan (approval Manager); pembatalan TIDAK berarti uang dikembalikan.
 */
export async function cancelOrder(
  db: Database,
  actor: CurrentUser,
  raw: unknown,
  context: AuditContext,
): Promise<{ result: "cancelled" | "approval_requested" }> {
  const input = parse(cancelInput, raw);
  const order = await loadOrderForStaff(db, actor, input.orderId);
  assertAt(actor, "order.void", order.outletId);

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(orders).where(eq(orders.id, order.id)).for("update");
    if ((TERMINAL_STATUSES as readonly string[]).includes(locked.status)) {
      throw new AccessError("conflict", "Pesanan sudah selesai atau dibatalkan.");
    }
    const base = {
      companyId: locked.companyId,
      brandId: locked.brandId,
      outletId: locked.outletId,
      actorId: actor.id,
      entityType: "order",
      entityId: locked.id,
    };

    if (locked.paymentStatus !== "paid") {
      await tx
        .update(orders)
        .set({
          status: "cancelled",
          paymentStatus: "expired",
          cancelledAt: sql`clock_timestamp()`,
          cancelReason: input.reason,
        })
        .where(eq(orders.id, locked.id));
      await tx
        .update(payments)
        .set({ status: "expired" })
        .where(and(eq(payments.orderId, locked.id), eq(payments.status, "pending")));
      await recordAudit(
        tx,
        {
          ...base,
          action: "order.cancelled",
          before: { status: locked.status },
          after: { status: "cancelled", paid: false },
          reason: input.reason,
        },
        context,
      );
      await notify(tx, topicsFor(locked));
      return { result: "cancelled" as const };
    }

    const [pending] = await tx
      .select({ id: approvals.id })
      .from(approvals)
      .where(
        and(
          eq(approvals.type, "void"),
          eq(approvals.referenceId, locked.id),
          eq(approvals.status, "pending"),
        ),
      )
      .limit(1);
    if (pending) {
      throw new AccessError("conflict", "Pembatalan sudah diajukan dan menunggu persetujuan.");
    }
    const [approval] = await tx
      .insert(approvals)
      .values({
        companyId: locked.companyId,
        brandId: locked.brandId,
        outletId: locked.outletId,
        type: "void",
        referenceId: locked.id,
        reason: input.reason,
        requestedBy: actor.id,
      })
      .returning({ id: approvals.id });
    await recordAudit(
      tx,
      {
        ...base,
        action: "order.cancel_requested",
        after: { approvalId: approval.id, orderNumber: locked.orderNumber },
        reason: input.reason,
      },
      context,
    );
    await notify(tx, [outletOrdersTopic(locked.outletId)]);
    return { result: "approval_requested" as const };
  });
}

export const decisionInput = z.object({
  approvalId: z.uuid(),
  approve: z.boolean(),
  note: z.string().trim().max(300).optional(),
});

export async function decideCancellation(
  db: Database,
  actor: CurrentUser,
  raw: unknown,
  context: AuditContext,
) {
  const input = parse(decisionInput, raw);
  const [approval] = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.id, input.approvalId),
        eq(approvals.companyId, actor.company.id),
        eq(approvals.type, "void"),
      ),
    )
    .limit(1);
  if (!approval) throw notFound();
  assertAt(actor, input.approve ? "approval.approve" : "approval.reject", approval.outletId);
  if (approval.requestedBy === actor.id) {
    throw new AccessError("forbidden", "Anda tidak bisa memutuskan pengajuan Anda sendiri.");
  }

  let menuBrandId: string | null = null;
  return db.transaction(async (tx) => {
    const [decided] = await tx
      .update(approvals)
      .set({
        status: input.approve ? "approved" : "rejected",
        decidedBy: actor.id,
        decisionNote: input.note || null,
        decidedAt: sql`clock_timestamp()`,
      })
      .where(and(eq(approvals.id, approval.id), eq(approvals.status, "pending")))
      .returning({ id: approvals.id });
    if (!decided) throw new AccessError("conflict", "Pengajuan ini sudah diputuskan.");

    const [locked] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, approval.referenceId))
      .for("update");
    const base = {
      companyId: locked.companyId,
      brandId: locked.brandId,
      outletId: locked.outletId,
      actorId: actor.id,
      entityType: "order",
      entityId: locked.id,
    };

    if (input.approve) {
      if ((TERMINAL_STATUSES as readonly string[]).includes(locked.status)) {
        throw new AccessError(
          "conflict",
          "Pesanan sudah selesai/dibatalkan; gunakan proses refund terpisah.",
        );
      }
      await tx
        .update(orders)
        .set({
          status: "cancelled",
          cancelledAt: sql`clock_timestamp()`,
          cancelReason: approval.reason,
        })
        .where(eq(orders.id, locked.id));
      // Produk jadi belum diserahkan → stok dikembalikan lewat reversal ledger.
      const reversed = await reverseSaleMovements(tx, {
        orderId: locked.id,
        actorId: actor.id,
        reason: `Pembatalan order ${locked.orderNumber ?? orderReference(locked.id)}`,
      });
      if (reversed.some(crossedZero)) menuBrandId = locked.brandId;
      await recordAudit(
        tx,
        {
          ...base,
          action: "order.cancelled",
          before: { status: locked.status },
          // Status pembayaran tetap "paid": pengembalian uang = proses refund.
          after: { status: "cancelled", paid: true, approvalId: approval.id },
          reason: approval.reason,
        },
        context,
      );
    }
    await recordAudit(
      tx,
      {
        ...base,
        action: input.approve ? "approval.approved" : "approval.rejected",
        after: { approvalId: approval.id, type: "void" },
        reason: input.note,
      },
      context,
    );
    await notify(tx, topicsFor(locked));
    return { approved: input.approve, menuBrandId };
  });
}

// --- Query ---------------------------------------------------------------------------------

export type OrderLineView = {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  modifiersTotal: number;
  lineTotal: number;
  notes: string | null;
  modifiers: { groupName: string; name: string; priceDelta: number }[];
};

async function loadLines(db: DbExecutor, orderIds: string[]) {
  const map = new Map<string, OrderLineView[]>();
  if (orderIds.length === 0) return map;
  const items = await db
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds))
    .orderBy(asc(orderItems.id));
  const mods = items.length
    ? await db
        .select()
        .from(orderItemModifiers)
        .where(inArray(orderItemModifiers.orderItemId, items.map((i) => i.id)))
    : [];
  for (const item of items) {
    const list = map.get(item.orderId) ?? [];
    list.push({
      id: item.id,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      modifiersTotal: item.modifiersTotal,
      lineTotal: item.lineTotal,
      notes: item.notes,
      modifiers: mods
        .filter((m) => m.orderItemId === item.id)
        .map((m) => ({ groupName: m.groupName, name: m.modifierName, priceDelta: m.priceDelta })),
    });
    map.set(item.orderId, list);
  }
  return map;
}

export async function getOrderDetail(db: DbExecutor, actor: CurrentUser, orderId: string) {
  const id = parse(z.uuid({ error: "ID tidak valid." }), orderId);
  const order = await loadOrderForStaff(db, actor, id);
  assertAt(actor, "order.view", order.outletId);

  const confirmer = alias(users, "confirmer");
  const requester = alias(users, "requester");
  const actorUser = alias(users, "actor_user");
  const [outlet, lines, paymentRows, pendingApproval, history, creator] = await Promise.all([
    loadOutlet(db, eq(outlets.id, order.outletId)),
    loadLines(db, [order.id]),
    db
      .select({
        id: payments.id,
        method: payments.method,
        status: payments.status,
        amount: payments.amount,
        tenderedAmount: payments.tenderedAmount,
        changeAmount: payments.changeAmount,
        paidAt: payments.paidAt,
        confirmedByName: confirmer.fullName,
      })
      .from(payments)
      .leftJoin(confirmer, eq(confirmer.id, payments.confirmedBy))
      .where(eq(payments.orderId, order.id))
      .orderBy(asc(payments.createdAt)),
    db
      .select({
        id: approvals.id,
        reason: approvals.reason,
        requestedBy: approvals.requestedBy,
        requestedByName: requester.fullName,
        createdAt: approvals.createdAt,
      })
      .from(approvals)
      .innerJoin(requester, eq(requester.id, approvals.requestedBy))
      .where(
        and(
          eq(approvals.type, "void"),
          eq(approvals.referenceId, order.id),
          eq(approvals.status, "pending"),
        ),
      )
      .limit(1),
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        createdAt: auditLogs.createdAt,
        before: auditLogs.before,
        after: auditLogs.after,
        reason: auditLogs.reason,
        actorName: actorUser.fullName,
      })
      .from(auditLogs)
      .leftJoin(actorUser, eq(actorUser.id, auditLogs.actorId))
      .where(
        and(
          eq(auditLogs.companyId, actor.company.id),
          eq(auditLogs.entityType, "order"),
          eq(auditLogs.entityId, order.id),
        ),
      )
      .orderBy(asc(auditLogs.createdAt)),
    order.createdBy
      ? db.select({ name: users.fullName }).from(users).where(eq(users.id, order.createdBy)).limit(1)
      : Promise.resolve([]),
  ]);

  const { accessTokenHash: _hidden, ...safeOrder } = order;
  void _hidden;
  return {
    ...safeOrder,
    reference: orderReference(order.id),
    outlet: outlet!,
    lines: lines.get(order.id) ?? [],
    payments: paymentRows,
    pendingApproval: pendingApproval[0] ?? null,
    history,
    createdByName: creator[0]?.name ?? null,
  };
}
export type OrderDetail = Awaited<ReturnType<typeof getOrderDetail>>;

export const ORDER_PAGE_SIZE = 25;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const orderListParams = z.object({
  q: z.string().trim().max(60).optional().catch(undefined),
  from: z.string().regex(datePattern).optional().catch(undefined),
  to: z.string().regex(datePattern).optional().catch(undefined),
  channel: z.enum(["pos", "qr_table", "qr_counter", "website", "kiosk"]).optional().catch(undefined),
  payment: z.enum(["pending", "paid", "failed", "expired", "refunded", "partial_refund"]).optional().catch(undefined),
  /** "active" = sudah dibayar & belum selesai. */
  status: z.enum([...ORDER_STATUSES, "active"]).optional().catch(undefined),
  outlet: z.uuid().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type OrderListParams = z.infer<typeof orderListParams>;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listOrders(db: DbExecutor, actor: CurrentUser, params: OrderListParams) {
  const allowed = await outletsWithPermission(db, actor, "order.view");
  if (allowed.length === 0) throw forbidden();
  const outletIds = params.outlet
    ? allowed.filter((o) => o.id === params.outlet).map((o) => o.id)
    : allowed.map((o) => o.id);
  if (outletIds.length === 0) throw forbidden();

  const localDate = sql`(${orders.createdAt} at time zone ${outlets.timezone})::date`;
  const conditions: (SQL | undefined)[] = [
    inArray(orders.outletId, outletIds),
    eq(orders.companyId, actor.company.id),
  ];
  if (params.q) {
    const q = params.q;
    const pattern = `%${escapeLike(q)}%`;
    conditions.push(
      or(
        ilike(orders.orderNumber, pattern),
        ilike(orders.customerName, pattern),
        sql`upper(replace(${orders.id}::text, '-', '')) like ${`${escapeLike(q.toUpperCase())}%`}`,
      ),
    );
  }
  if (params.from) conditions.push(sql`${localDate} >= ${params.from}::date`);
  if (params.to) conditions.push(sql`${localDate} <= ${params.to}::date`);
  if (params.channel) conditions.push(eq(orders.channel, params.channel));
  if (params.payment) conditions.push(eq(orders.paymentStatus, params.payment));
  if (params.status === "active") {
    conditions.push(inArray(orders.status, [...ACTIVE_QUEUE_STATUSES]));
  } else if (params.status) {
    conditions.push(eq(orders.status, params.status));
  }
  const where = and(...conditions);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(orders)
    .innerJoin(outlets, eq(outlets.id, orders.outletId))
    .where(where);
  const pageCount = Math.max(1, Math.ceil(total / ORDER_PAGE_SIZE));
  const page = Math.min(params.page, pageCount);

  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      channel: orders.channel,
      type: orders.type,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      customerName: orders.customerName,
      tableNumber: orders.tableNumber,
      total: orders.total,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      outletName: outlets.name,
      timezone: outlets.timezone,
    })
    .from(orders)
    .innerJoin(outlets, eq(outlets.id, orders.outletId))
    .where(where)
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(ORDER_PAGE_SIZE)
    .offset((page - 1) * ORDER_PAGE_SIZE);

  return {
    rows: rows.map((r) => ({ ...r, reference: orderReference(r.id) })),
    total,
    page,
    pageCount,
    outlets: allowed,
  };
}

/** Papan KDS: order lunas yang belum selesai + yang baru selesai (PRD §38). */
export async function getKdsBoard(db: DbExecutor, actor: CurrentUser, outletId: string) {
  const id = parse(z.uuid(), outletId);
  const outlet = await loadOutlet(db, and(eq(outlets.id, id), eq(outlets.companyId, actor.company.id))!);
  if (!outlet) throw notFound();
  assertAt(actor, "kds.view", outlet.id);

  const columns = {
    id: orders.id,
    orderNumber: orders.orderNumber,
    queueNumber: orders.queueNumber,
    status: orders.status,
    type: orders.type,
    channel: orders.channel,
    customerName: orders.customerName,
    tableNumber: orders.tableNumber,
    notes: orders.notes,
    paidAt: orders.paidAt,
    preparingAt: orders.preparingAt,
    readyAt: orders.readyAt,
    completedAt: orders.completedAt,
  };
  const [active, completed] = await Promise.all([
    db
      .select(columns)
      .from(orders)
      .where(
        and(
          eq(orders.outletId, outlet.id),
          eq(orders.paymentStatus, "paid"),
          inArray(orders.status, [...ACTIVE_QUEUE_STATUSES]),
        ),
      )
      // FIFO berdasarkan waktu bayar; nomor antrean sebagai pemutus seri.
      .orderBy(asc(orders.paidAt), asc(orders.queueNumber)),
    db
      .select(columns)
      .from(orders)
      .where(
        and(
          eq(orders.outletId, outlet.id),
          eq(orders.status, "completed"),
          gte(orders.completedAt, sql`now() - interval '3 hours'`),
        ),
      )
      .orderBy(desc(orders.completedAt))
      .limit(12),
  ]);
  const lines = await loadLines(db, [...active, ...completed].map((o) => o.id));
  const withLines = (rows: typeof active) =>
    rows.map((o) => ({ ...o, lines: lines.get(o.id) ?? [] }));
  return { outlet, orders: [...withLines(active), ...withLines(completed)] };
}
export type KdsOrder = Awaited<ReturnType<typeof getKdsBoard>>["orders"][number];

/** Order milik guest — hanya jika token cocok. Mengembalikan data publik saja. */
export async function getGuestOrder(db: DbExecutor, orderId: string, token: string | undefined) {
  if (!z.uuid().safeParse(orderId).success || !token) return null;
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      type: orders.type,
      channel: orders.channel,
      tableNumber: orders.tableNumber,
      customerName: orders.customerName,
      deliveryAddress: orders.deliveryAddress,
      notes: orders.notes,
      total: orders.total,
      createdAt: orders.createdAt,
      expiresAt: orders.expiresAt,
      accessTokenHash: orders.accessTokenHash,
      outletName: outlets.name,
      outletCode: outlets.code,
      timezone: outlets.timezone,
    })
    .from(orders)
    .innerJoin(outlets, eq(outlets.id, orders.outletId))
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order || !verifyAccessToken(token, order.accessTokenHash)) return null;

  const [lines, paymentRows] = await Promise.all([
    loadLines(db, [order.id]),
    db
      .select({ method: payments.method })
      .from(payments)
      .where(eq(payments.orderId, order.id))
      .orderBy(asc(payments.createdAt))
      .limit(1),
  ]);
  const { accessTokenHash, ...rest } = order;
  return {
    ...rest,
    reference: orderReference(order.id),
    paymentMethod: paymentRows[0]?.method ?? null,
    lines: lines.get(order.id) ?? [],
    topic: guestOrderTopic(accessTokenHash!),
  };
}

export type { OrderStatus, PaymentStatus };
