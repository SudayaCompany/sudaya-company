// Operasi inventory (PRD §18–25, §69). Pola sama dengan order engine:
// actor dari session, permission + scope outlet dicek ulang di sini, input
// divalidasi Zod, setiap perubahan stok lewat ledger (postMovement) di dalam
// transaksi, dan dicatat di audit log.
//
// Kebijakan approval:
// - stok masuk, stok keluar, waste: langsung (operasional harian, diaudit);
// - koreksi manual & reversal movement: approval (Admin → Manager), stok
//   baru berubah saat disetujui;
// - stock opname dengan selisih: approval; tanpa selisih langsung selesai.
// Pengaju tidak bisa memutuskan pengajuannya sendiri (four-eyes).

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database, DbExecutor } from "@/db/client";
import {
  approvals,
  inventoryAdjustments,
  inventoryItems,
  inventoryTransactions,
  outletProducts,
  outlets,
  products,
  stockOpnameItems,
  stockOpnames,
} from "@/db/schema";
import { recordAudit, type AuditContext, type AuditEntry } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth/access";
import { AccessError } from "@/lib/auth/errors";
import { hasPermission } from "@/lib/auth/policy";
import type { Permission } from "@/lib/auth/rbac";
import { businessDateIn } from "@/lib/orders/dates";

import { evidencePath, type EvidencePhoto, type EvidenceStorage } from "./evidence";
import { crossedZero, postMovement, type MovementType, type PostedMovement } from "./ledger";
import {
  ISSUE_REASONS,
  STOCK_IN_LABELS,
  adjustmentInput,
  itemCreateInput,
  itemUpdateInput,
  linkProductsInput,
  openingBalanceInput,
  opnameCountsInput,
  opnameCreateInput,
  opnameRefInput,
  reversalInput,
  stockDecisionInput,
  stockInInput,
  stockOutInput,
} from "./schemas";
import {
  convertQty,
  convertUnitCost,
  formatQty,
  isCountUnit,
  isUnitCode,
  parseQty,
  qtyFromDb,
  qtyToString,
  type UnitCode,
} from "./units";

const forbidden = () => new AccessError("forbidden", "Anda tidak memiliki izin untuk tindakan ini.");
const notFound = () => new AccessError("not_found", "Data stok tidak ditemukan.");

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AccessError("invalid", result.error.issues[0]?.message ?? "Input tidak valid.");
  }
  return result.data;
}

export function assertInventory(actor: CurrentUser, permission: Permission, outletId: string) {
  if (!actor.isActive || !hasPermission(actor, permission, { outletId })) throw forbidden();
}

/** Movement manual yang boleh dibalik lewat reversal (dengan approval). */
export const REVERSIBLE_TYPES: readonly MovementType[] = [
  "opening",
  "purchase",
  "return",
  "stock_out",
  "internal_use",
  "waste",
  "expired",
  "damaged",
];

/** Penjualan dibalik lewat pembatalan order; opname lewat opname baru. */
export const isReversible = (type: MovementType) => REVERSIBLE_TYPES.includes(type);

const UNIQUE_MESSAGES: Record<string, string> = {
  inventory_items_outletId_sku_unique: "SKU sudah dipakai item lain di outlet ini.",
  stock_opnames_one_open_per_outlet: "Masih ada stock opname yang belum selesai di outlet ini.",
  inventory_transactions_reversesId_unique: "Movement ini sudah pernah dibalik.",
};

function mapUniqueViolation(error: unknown): never {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    const e = current as { code?: string; constraint_name?: string; cause?: unknown };
    if (e.code === "23505") {
      throw new AccessError("conflict", UNIQUE_MESSAGES[e.constraint_name ?? ""] ?? "Data sudah ada.");
    }
    current = e.cause;
  }
  throw error;
}

async function loadOutlet(db: DbExecutor, actor: CurrentUser, outletId: string) {
  const [outlet] = await db
    .select({
      id: outlets.id,
      companyId: outlets.companyId,
      brandId: outlets.brandId,
      timezone: outlets.timezone,
    })
    .from(outlets)
    .where(and(eq(outlets.id, outletId), eq(outlets.companyId, actor.company.id)))
    .limit(1);
  if (!outlet) throw notFound();
  return outlet;
}

async function loadItem(db: DbExecutor, actor: CurrentUser, itemId: string) {
  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.companyId, actor.company.id)))
    .limit(1);
  if (!item) throw notFound();
  return item;
}

type Item = Awaited<ReturnType<typeof loadItem>>;

const itemUnit = (item: Item): UnitCode => {
  if (!isUnitCode(item.unit)) throw new AccessError("invalid", `Satuan item ${item.unit} tidak dikenal.`);
  return item.unit;
};

/** Konversi jumlah input ke satuan dasar item; harus > 0. */
function inputQty(item: Item, quantity: string, unit: UnitCode) {
  const converted = convertQty(quantity, unit, itemUnit(item));
  if (!converted.ok) throw new AccessError("invalid", converted.error);
  if (converted.milli <= 0n) throw new AccessError("invalid", "Jumlah harus lebih dari 0.");
  return converted.milli;
}

function costOrNull(value: string | null, from: UnitCode, to: UnitCode) {
  if (value === null) return null;
  const converted = convertUnitCost(value, from, to);
  if (!converted.ok) throw new AccessError("invalid", converted.error);
  return converted.value;
}

const auditBase = (item: Pick<Item, "companyId" | "brandId" | "outletId">, actor: CurrentUser) => ({
  companyId: item.companyId,
  brandId: item.brandId,
  outletId: item.outletId,
  actorId: actor.id,
});

const stockAudit = (m: PostedMovement) => ({
  stock: qtyToString(m.before),
  stockAfter: qtyToString(m.after),
  unit: m.unit,
});

export type StockChange = {
  movementId: string;
  balance: string;
  unit: string;
  replayed: boolean;
  /** Brand yang katalognya perlu di-refresh (sold out berubah), atau null. */
  menuBrandId: string | null;
};

const stockChange = (m: PostedMovement): StockChange => ({
  movementId: m.movementId,
  balance: qtyToString(m.after),
  unit: m.unit,
  replayed: m.replayed,
  menuBrandId: crossedZero(m) ? m.brandId : null,
});

// --- Item master -------------------------------------------------------------------

export async function createItem(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(itemCreateInput, raw);
  const outlet = await loadOutlet(db, actor, input.outletId);
  assertInventory(actor, "inventory.adjust", outlet.id);
  const purchasePrice = costOrNull(input.purchasePrice, input.unit, input.unit);
  const opening = parseQty(input.openingStock)!;

  try {
    return await db.transaction(async (tx) => {
      const [item] = await tx
        .insert(inventoryItems)
        .values({
          companyId: outlet.companyId,
          brandId: outlet.brandId,
          outletId: outlet.id,
          sku: input.sku,
          name: input.name,
          kind: input.kind,
          category: input.category,
          unit: input.unit,
          minimumStock: input.minimumStock,
          purchasePrice,
          expiryDate: input.expiryDate,
        })
        .returning({ id: inventoryItems.id });

      await recordAudit(
        tx,
        {
          ...auditBase({ ...outlet, outletId: outlet.id }, actor),
          action: "inventory.item_created",
          entityType: "inventory_item",
          entityId: item.id,
          after: {
            sku: input.sku,
            name: input.name,
            kind: input.kind,
            unit: input.unit,
            minimumStock: input.minimumStock,
            purchasePrice,
          },
        },
        context,
      );

      if (opening > 0n) {
        const posted = await postMovement(tx, {
          itemId: item.id,
          type: "opening",
          quantity: opening,
          idempotencyKey: `opening:${item.id}`,
          actorId: actor.id,
          reason: "Saldo awal",
        });
        await recordAudit(
          tx,
          {
            ...auditBase({ ...outlet, outletId: outlet.id }, actor),
            action: "inventory.opening_balance",
            entityType: "inventory_item",
            entityId: item.id,
            before: { stock: "0" },
            after: stockAudit(posted),
          },
          context,
        );
      }
      return { id: item.id };
    });
  } catch (error) {
    mapUniqueViolation(error);
  }
}

export async function updateItem(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(itemUpdateInput, raw);
  const item = await loadItem(db, actor, input.itemId);
  assertInventory(actor, "inventory.adjust", item.outletId);
  const unit = itemUnit(item);
  const purchasePrice = costOrNull(input.purchasePrice, unit, unit);
  if (isCountUnit(unit) && parseQty(input.minimumStock)! % 1000n !== 0n) {
    throw new AccessError("invalid", "Minimum stok satuan ini harus bilangan bulat.");
  }

  const linked = await db
    .select({ productId: outletProducts.productId })
    .from(outletProducts)
    .where(eq(outletProducts.inventoryItemId, item.id));
  if (linked.length && input.kind !== "finished_good") {
    throw new AccessError("conflict", "Item masih terhubung ke menu. Lepas hubungan produk terlebih dahulu.");
  }

  const next = {
    name: input.name,
    kind: input.kind,
    category: input.category,
    minimumStock: qtyToString(parseQty(input.minimumStock)!),
    purchasePrice,
    expiryDate: input.expiryDate,
    isActive: input.isActive,
  };
  const prev = {
    name: item.name,
    kind: item.kind,
    category: item.category,
    minimumStock: qtyToString(qtyFromDb(item.minimumStock)),
    purchasePrice: item.purchasePrice === null ? null : String(Number(item.purchasePrice)),
    expiryDate: item.expiryDate,
    isActive: item.isActive,
  };
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    const a = key === "purchasePrice" && next[key] !== null ? String(Number(next[key])) : next[key];
    if (JSON.stringify(prev[key]) !== JSON.stringify(a)) {
      before[key] = prev[key];
      after[key] = a;
    }
  }

  await db.transaction(async (tx) => {
    await tx.update(inventoryItems).set(next).where(eq(inventoryItems.id, item.id));
    if (Object.keys(after).length) {
      await recordAudit(
        tx,
        {
          ...auditBase(item, actor),
          action: "inventory.item_updated",
          entityType: "inventory_item",
          entityId: item.id,
          before,
          after,
        },
        context,
      );
    }
  });
  // Aktif/nonaktif item produk jadi mengubah sold out menu.
  return { menuBrandId: linked.length && "isActive" in after ? item.brandId : null };
}

/** Hubungkan produk menu (outlet tsb) ke item produk jadi → sold out otomatis saat stok 0. */
export async function setItemProducts(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(linkProductsInput, raw);
  const item = await loadItem(db, actor, input.itemId);
  assertInventory(actor, "inventory.adjust", item.outletId);
  // Menghubungkan menu = mengubah ketersediaan menu → juga butuh izin edit menu.
  if (!hasPermission(actor, "product.edit", { outletId: item.outletId })) throw forbidden();
  if (input.productIds.length && item.kind !== "finished_good") {
    throw new AccessError("invalid", "Hanya item produk jadi yang bisa dihubungkan ke menu.");
  }
  if (input.productIds.length && !isCountUnit(itemUnit(item))) {
    throw new AccessError("invalid", "Produk jadi yang dijual per unit harus bersatuan hitung (pcs, botol, ...).");
  }

  const wanted = [...new Set(input.productIds)];
  const valid = wanted.length
    ? await db
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            inArray(products.id, wanted),
            eq(products.brandId, item.brandId),
            eq(products.companyId, actor.company.id),
            isNull(products.deletedAt),
          ),
        )
    : [];
  if (valid.length !== wanted.length) throw new AccessError("invalid", "Produk tidak valid untuk outlet ini.");

  return db.transaction(async (tx) => {
    const current = await tx
      .select({ productId: outletProducts.productId })
      .from(outletProducts)
      .where(and(eq(outletProducts.outletId, item.outletId), eq(outletProducts.inventoryItemId, item.id)));
    const currentIds = current.map((c) => c.productId);
    const removed = currentIds.filter((id) => !wanted.includes(id));
    if (removed.length) {
      await tx
        .update(outletProducts)
        .set({ inventoryItemId: null })
        .where(
          and(
            eq(outletProducts.outletId, item.outletId),
            eq(outletProducts.inventoryItemId, item.id),
            inArray(outletProducts.productId, removed),
          ),
        );
    }
    for (const productId of wanted) {
      // Hanya kolom link yang diubah; status manual sold out (is_available) tetap.
      await tx
        .insert(outletProducts)
        .values({ outletId: item.outletId, productId, inventoryItemId: item.id })
        .onConflictDoUpdate({
          target: [outletProducts.outletId, outletProducts.productId],
          set: { inventoryItemId: item.id },
        });
    }
    const added = wanted.filter((id) => !currentIds.includes(id));
    if (added.length || removed.length) {
      await recordAudit(
        tx,
        {
          ...auditBase(item, actor),
          action: "inventory.products_linked",
          entityType: "inventory_item",
          entityId: item.id,
          before: { productIds: currentIds },
          after: { productIds: wanted },
        },
        context,
      );
    }
    return { menuBrandId: added.length || removed.length ? item.brandId : null };
  });
}

/** Saldo awal untuk item yang belum punya movement sama sekali. */
export async function setOpeningBalance(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(openingBalanceInput, raw);
  const item = await loadItem(db, actor, input.itemId);
  assertInventory(actor, "inventory.adjust", item.outletId);
  const quantity = inputQty(item, input.quantity, itemUnit(item));

  return db.transaction(async (tx) => {
    await tx.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.id, item.id)).for("update");
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.itemId, item.id));
    if (count > 0) {
      throw new AccessError("conflict", "Item sudah punya mutasi; saldo awal tidak bisa diubah. Gunakan koreksi stok.");
    }
    const posted = await postMovement(tx, {
      itemId: item.id,
      type: "opening",
      quantity,
      idempotencyKey: `opening:${item.id}`,
      actorId: actor.id,
      reason: "Saldo awal",
    });
    await recordAudit(
      tx,
      {
        ...auditBase(item, actor),
        action: "inventory.opening_balance",
        entityType: "inventory_item",
        entityId: item.id,
        before: { stock: "0" },
        after: stockAudit(posted),
      },
      context,
    );
    return stockChange(posted);
  });
}

// --- Stok masuk / keluar / waste ---------------------------------------------------------

export async function recordStockIn(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(stockInInput, raw);
  const item = await loadItem(db, actor, input.itemId);
  assertInventory(actor, "inventory.receive", item.outletId);
  const base = itemUnit(item);
  const quantity = inputQty(item, input.quantity, input.unit);
  const unitCost = costOrNull(input.unitCost, input.unit, base);

  const [outlet] = await db.select({ timezone: outlets.timezone }).from(outlets).where(eq(outlets.id, item.outletId));
  if (input.effectiveDate > businessDateIn(outlet.timezone)) {
    throw new AccessError("invalid", "Tanggal tidak boleh di masa depan.");
  }

  return db.transaction(async (tx) => {
    const posted = await postMovement(tx, {
      itemId: item.id,
      type: input.type,
      quantity,
      idempotencyKey: `stock-in:${input.idempotencyKey}`,
      actorId: actor.id,
      unitCost: unitCost ?? item.purchasePrice,
      reason: input.notes,
      documentRef: input.documentRef,
      batchCode: input.batchCode,
      expiryDate: input.expiryDate,
      effectiveDate: input.effectiveDate,
    });
    if (posted.replayed) return stockChange(posted);

    // Harga beli terakhir menjadi harga pokok item (metode last purchase price).
    const costChanged = input.type === "purchase" && unitCost !== null && unitCost !== normalizeCost(item.purchasePrice);
    if (costChanged) {
      await tx.update(inventoryItems).set({ purchasePrice: unitCost }).where(eq(inventoryItems.id, item.id));
    }
    await recordAudit(
      tx,
      {
        ...auditBase(item, actor),
        action: "inventory.stock_in",
        entityType: "inventory_item",
        entityId: item.id,
        before: { stock: qtyToString(posted.before), ...(costChanged ? { purchasePrice: normalizeCost(item.purchasePrice) } : {}) },
        after: {
          ...stockAudit(posted),
          type: STOCK_IN_LABELS[input.type],
          quantity: qtyToString(quantity),
          input: `${input.quantity} ${input.unit}`,
          documentRef: input.documentRef,
          ...(costChanged ? { purchasePrice: unitCost } : {}),
        },
        reason: input.notes ?? undefined,
      },
      context,
    );
    return stockChange(posted);
  });
}

const normalizeCost = (value: string | null) => (value === null ? null : String(Number(value)));

/**
 * Stok keluar & waste. Foto bukti (opsional) diunggah dulu ke bucket privat;
 * jika transaksi gagal atau ternyata request ulang, file dihapus lagi.
 */
export async function recordStockOut(
  db: Database,
  actor: CurrentUser,
  raw: unknown,
  photo: EvidencePhoto | null,
  storage: EvidenceStorage,
  context: AuditContext,
) {
  const input = parse(stockOutInput, raw);
  const item = await loadItem(db, actor, input.itemId);
  assertInventory(actor, "inventory.issue", item.outletId);
  const quantity = inputQty(item, input.quantity, input.unit);
  const reason = ISSUE_REASONS[input.reason];

  const photoPath = photo ? evidencePath(item.companyId, item.outletId, photo.ext) : null;
  if (photo && photoPath) await storage.upload(photoPath, photo.bytes, photo.contentType);

  try {
    const result = await db.transaction(async (tx) => {
      const posted = await postMovement(tx, {
        itemId: item.id,
        type: reason.type,
        quantity: -quantity,
        idempotencyKey: `stock-out:${input.idempotencyKey}`,
        actorId: actor.id,
        reason: input.notes ? `${reason.label}: ${input.notes}` : reason.label,
        photoPath,
      });
      if (posted.replayed) return stockChange(posted);
      await recordAudit(
        tx,
        {
          ...auditBase(item, actor),
          action: reason.waste ? "inventory.waste" : "inventory.stock_out",
          entityType: "inventory_item",
          entityId: item.id,
          before: { stock: qtyToString(posted.before) },
          after: {
            ...stockAudit(posted),
            type: reason.label,
            quantity: qtyToString(-quantity),
            input: `${input.quantity} ${input.unit}`,
            evidence: Boolean(photoPath),
          },
          reason: input.notes ?? reason.label,
        },
        context,
      );
      return stockChange(posted);
    });
    if (result.replayed && photoPath) await storage.remove([photoPath]).catch(() => {});
    return result;
  } catch (error) {
    if (photoPath) await storage.remove([photoPath]).catch(() => {});
    throw error;
  }
}

// --- Koreksi & reversal (approval) -------------------------------------------------------

async function assertNoPendingReversal(db: DbExecutor, movementId: string) {
  const [pending] = await db
    .select({ id: inventoryAdjustments.id })
    .from(inventoryAdjustments)
    .innerJoin(approvals, eq(approvals.id, inventoryAdjustments.approvalId))
    .where(and(eq(inventoryAdjustments.reversesId, movementId), eq(approvals.status, "pending")))
    .limit(1);
  if (pending) throw new AccessError("conflict", "Reversal movement ini sudah diajukan dan menunggu persetujuan.");
}

async function createAdjustmentRequest(
  db: Database,
  actor: CurrentUser,
  params: { item: Item; quantity: bigint; reason: string; reversesId: string | null },
  context: AuditContext,
) {
  const { item, quantity, reason, reversesId } = params;
  return db.transaction(async (tx) => {
    if (reversesId) await assertNoPendingReversal(tx, reversesId);
    const adjustmentId = randomUUID();
    const [approval] = await tx
      .insert(approvals)
      .values({
        companyId: item.companyId,
        brandId: item.brandId,
        outletId: item.outletId,
        type: "stock_adjustment",
        referenceId: adjustmentId,
        reason,
        requestedBy: actor.id,
      })
      .returning({ id: approvals.id });
    await tx.insert(inventoryAdjustments).values({
      id: adjustmentId,
      companyId: item.companyId,
      brandId: item.brandId,
      outletId: item.outletId,
      itemId: item.id,
      quantity: qtyToString(quantity),
      reason,
      reversesId,
      approvalId: approval.id,
      createdBy: actor.id,
    });
    await recordAudit(
      tx,
      {
        ...auditBase(item, actor),
        action: reversesId ? "inventory.reversal_requested" : "inventory.adjustment_requested",
        entityType: "inventory_item",
        entityId: item.id,
        before: { stock: qtyToString(qtyFromDb(item.stockQty)), unit: item.unit },
        after: { quantity: qtyToString(quantity), approvalId: approval.id, reversesId },
        reason,
      },
      context,
    );
    return { approvalId: approval.id };
  });
}

/** Koreksi stok manual (+/−). Stok BELUM berubah sampai approval disetujui. */
export async function requestAdjustment(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(adjustmentInput, raw);
  const item = await loadItem(db, actor, input.itemId);
  assertInventory(actor, "inventory.adjust", item.outletId);
  const magnitude = inputQty(item, input.quantity, input.unit);
  const quantity = input.direction === "in" ? magnitude : -magnitude;
  if (qtyFromDb(item.stockQty) + quantity < 0n) {
    throw new AccessError("conflict", `Koreksi melebihi stok saat ini (${formatQty(item.stockQty, item.unit)}).`);
  }
  return createAdjustmentRequest(db, actor, { item, quantity, reason: input.reason, reversesId: null }, context);
}

/** Ajukan pembalikan satu movement (satu-satunya cara memperbaiki salah input). */
export async function requestReversal(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(reversalInput, raw);
  const [movement] = await db
    .select()
    .from(inventoryTransactions)
    .where(and(eq(inventoryTransactions.id, input.movementId), eq(inventoryTransactions.companyId, actor.company.id)))
    .limit(1);
  if (!movement) throw notFound();
  assertInventory(actor, "inventory.adjust", movement.outletId);
  if (!isReversible(movement.type)) {
    throw new AccessError(
      "invalid",
      movement.type === "sale"
        ? "Penjualan dikembalikan lewat pembatalan order."
        : "Movement jenis ini tidak bisa dibalik. Gunakan koreksi stok atau opname baru.",
    );
  }
  const [already] = await db
    .select({ id: inventoryTransactions.id })
    .from(inventoryTransactions)
    .where(eq(inventoryTransactions.reversesId, movement.id))
    .limit(1);
  if (already) throw new AccessError("conflict", "Movement ini sudah pernah dibalik.");
  const item = await loadItem(db, actor, movement.itemId);
  return createAdjustmentRequest(
    db,
    actor,
    { item, quantity: -qtyFromDb(movement.quantity), reason: input.reason, reversesId: movement.id },
    context,
  );
}

// --- Keputusan approval stok -------------------------------------------------------------

export async function decideStockApproval(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(stockDecisionInput, raw);
  const [approval] = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.id, input.approvalId),
        eq(approvals.companyId, actor.company.id),
        inArray(approvals.type, ["stock_adjustment", "stock_opname"]),
      ),
    )
    .limit(1);
  if (!approval) throw notFound();
  if (!actor.isActive || !hasPermission(actor, input.approve ? "approval.approve" : "approval.reject", { outletId: approval.outletId })) {
    throw forbidden();
  }
  if (approval.requestedBy === actor.id) {
    throw new AccessError("forbidden", "Anda tidak bisa memutuskan pengajuan Anda sendiri.");
  }

  return db.transaction(async (tx) => {
    // Hanya satu keputusan yang bisa menang: approval ganda / klik ganda gagal di sini.
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

    const decisionAudit: AuditEntry = {
      companyId: approval.companyId,
      brandId: approval.brandId,
      outletId: approval.outletId,
      actorId: actor.id,
      action: input.approve ? "approval.approved" : "approval.rejected",
      entityType: approval.type === "stock_opname" ? "stock_opname" : "inventory_adjustment",
      entityId: approval.referenceId,
      after: { approvalId: approval.id, type: approval.type },
      reason: input.note,
    };

    const outcome =
      approval.type === "stock_opname"
        ? await decideOpname(tx, actor, approval, input.approve, context)
        : await decideAdjustment(tx, actor, approval, input.approve, context);
    await recordAudit(tx, decisionAudit, context);
    return { approved: input.approve, ...outcome };
  });
}

type ApprovalRow = typeof approvals.$inferSelect;

async function decideAdjustment(
  tx: DbExecutor,
  actor: CurrentUser,
  approval: ApprovalRow,
  approve: boolean,
  context: AuditContext,
) {
  const [adjustment] = await tx
    .select()
    .from(inventoryAdjustments)
    .where(and(eq(inventoryAdjustments.id, approval.referenceId), eq(inventoryAdjustments.approvalId, approval.id)))
    .for("update");
  if (!adjustment) throw notFound();
  if (adjustment.movementId) throw new AccessError("conflict", "Koreksi ini sudah diposting.");
  if (!approve) return { menuBrandId: null };

  const quantity = qtyFromDb(adjustment.quantity);
  let unitCost: string | null | undefined;
  if (adjustment.reversesId) {
    const [original] = await tx
      .select({ unitCost: inventoryTransactions.unitCost })
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.id, adjustment.reversesId));
    unitCost = original?.unitCost ?? null;
  }
  let posted: PostedMovement;
  try {
    posted = await postMovement(tx, {
      itemId: adjustment.itemId,
      type: adjustment.reversesId ? "reversal" : quantity > 0n ? "adjustment_in" : "adjustment_out",
      quantity,
      idempotencyKey: `adjustment:${adjustment.id}`,
      actorId: actor.id,
      unitCost,
      reason: adjustment.reason,
      referenceType: "inventory_adjustment",
      referenceId: adjustment.id,
      reversesId: adjustment.reversesId,
      allowInactive: true,
    });
  } catch (error) {
    mapUniqueViolation(error);
  }
  await tx
    .update(inventoryAdjustments)
    .set({ movementId: posted.movementId })
    .where(eq(inventoryAdjustments.id, adjustment.id));
  await recordAudit(
    tx,
    {
      companyId: approval.companyId,
      brandId: approval.brandId,
      outletId: approval.outletId,
      actorId: actor.id,
      action: adjustment.reversesId ? "inventory.reversal_posted" : "inventory.adjustment_posted",
      entityType: "inventory_item",
      entityId: adjustment.itemId,
      before: { stock: qtyToString(posted.before) },
      after: { ...stockAudit(posted), approvalId: approval.id, requestedBy: approval.requestedBy },
      reason: adjustment.reason,
    },
    context,
  );
  return { menuBrandId: crossedZero(posted) ? posted.brandId : null };
}

// --- Stock opname ------------------------------------------------------------------------

/** Buat sesi + snapshot saldo sistem semua item aktif (opsional per kategori). */
export async function createOpname(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(opnameCreateInput, raw);
  const outlet = await loadOutlet(db, actor, input.outletId);
  assertInventory(actor, "inventory.opname", outlet.id);

  try {
    return await db.transaction(async (tx) => {
      const [opname] = await tx
        .insert(stockOpnames)
        .values({
          companyId: outlet.companyId,
          brandId: outlet.brandId,
          outletId: outlet.id,
          notes: input.notes,
          createdBy: actor.id,
        })
        .returning({ id: stockOpnames.id, snapshotAt: stockOpnames.snapshotAt });

      // Satu statement = satu snapshot konsisten untuk semua item.
      const inserted = await tx.execute(sql`
        insert into ${stockOpnameItems} (opname_id, item_id, system_qty)
        select ${opname.id}::uuid, i.id, i.stock_qty
        from ${inventoryItems} i
        where i.outlet_id = ${outlet.id}::uuid and i.is_active
          ${input.category ? sql`and i.category = ${input.category}` : sql``}
        returning item_id
      `);
      const count = (inserted as unknown as unknown[]).length;
      if (count === 0) throw new AccessError("invalid", "Tidak ada item aktif untuk dihitung.");

      await recordAudit(
        tx,
        {
          ...auditBase({ ...outlet, outletId: outlet.id }, actor),
          action: "inventory.opname_created",
          entityType: "stock_opname",
          entityId: opname.id,
          after: { items: count, category: input.category, snapshotAt: opname.snapshotAt },
        },
        context,
      );
      return { id: opname.id, items: count };
    });
  } catch (error) {
    mapUniqueViolation(error);
  }
}

async function lockOpname(tx: DbExecutor, actor: CurrentUser, opnameId: string) {
  const [opname] = await tx
    .select()
    .from(stockOpnames)
    .where(and(eq(stockOpnames.id, opnameId), eq(stockOpnames.companyId, actor.company.id)))
    .for("update");
  if (!opname) throw notFound();
  return opname;
}

/** Simpan hasil hitung fisik (boleh bertahap). Variance dihitung server. */
export async function saveOpnameCounts(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(opnameCountsInput, raw);
  return db.transaction(async (tx) => {
    const opname = await lockOpname(tx, actor, input.opnameId);
    assertInventory(actor, "inventory.opname", opname.outletId);
    if (opname.status !== "draft") throw new AccessError("conflict", "Opname ini sudah diajukan / selesai.");

    const rows = await tx
      .select({
        id: stockOpnameItems.id,
        itemId: stockOpnameItems.itemId,
        systemQty: stockOpnameItems.systemQty,
        unit: inventoryItems.unit,
        name: inventoryItems.name,
      })
      .from(stockOpnameItems)
      .innerJoin(inventoryItems, eq(inventoryItems.id, stockOpnameItems.itemId))
      .where(eq(stockOpnameItems.opnameId, opname.id));
    const byItem = new Map(rows.map((r) => [r.itemId, r]));

    let counted = 0;
    for (const count of input.counts) {
      const row = byItem.get(count.itemId);
      if (!row) throw new AccessError("invalid", "Item tidak termasuk dalam opname ini.");
      const raw = count.actualQty?.trim() ?? "";
      if (raw === "") {
        await tx
          .update(stockOpnameItems)
          .set({ actualQty: null, variance: null, reason: count.reason })
          .where(eq(stockOpnameItems.id, row.id));
        continue;
      }
      const actual = parseQty(raw);
      if (actual === null || actual < 0n) {
        throw new AccessError("invalid", `${row.name}: jumlah fisik harus angka ≥ 0 (maks. 3 desimal).`);
      }
      if (isUnitCode(row.unit) && isCountUnit(row.unit) && actual % 1000n !== 0n) {
        throw new AccessError("invalid", `${row.name}: jumlah ${row.unit} harus bilangan bulat.`);
      }
      const variance = actual - qtyFromDb(row.systemQty);
      await tx
        .update(stockOpnameItems)
        .set({ actualQty: qtyToString(actual), variance: qtyToString(variance), reason: count.reason })
        .where(eq(stockOpnameItems.id, row.id));
      counted++;
    }
    await recordAudit(
      tx,
      {
        companyId: opname.companyId,
        brandId: opname.brandId,
        outletId: opname.outletId,
        actorId: actor.id,
        action: "inventory.opname_counted",
        entityType: "stock_opname",
        entityId: opname.id,
        after: { counted, submitted: input.counts.length },
      },
      context,
    );
    return { counted };
  });
}

/** Ajukan opname: selisih ≠ 0 → approval; tanpa selisih → selesai tanpa posting. */
export async function submitOpname(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(opnameRefInput, raw);
  return db.transaction(async (tx) => {
    const opname = await lockOpname(tx, actor, input.opnameId);
    assertInventory(actor, "inventory.opname", opname.outletId);
    if (opname.status !== "draft") throw new AccessError("conflict", "Opname ini sudah diajukan / selesai.");

    const rows = await tx
      .select({
        actualQty: stockOpnameItems.actualQty,
        variance: stockOpnameItems.variance,
        reason: stockOpnameItems.reason,
        name: inventoryItems.name,
      })
      .from(stockOpnameItems)
      .innerJoin(inventoryItems, eq(inventoryItems.id, stockOpnameItems.itemId))
      .where(eq(stockOpnameItems.opnameId, opname.id));
    const counted = rows.filter((r) => r.actualQty !== null);
    if (counted.length === 0) throw new AccessError("invalid", "Belum ada item yang dihitung.");
    const withVariance = counted.filter((r) => qtyFromDb(r.variance) !== 0n);
    const missingReason = withVariance.find((r) => (r.reason?.trim().length ?? 0) < 3);
    if (missingReason) {
      throw new AccessError("invalid", `${missingReason.name}: alasan selisih wajib diisi (PRD §23).`);
    }

    const audit = {
      companyId: opname.companyId,
      brandId: opname.brandId,
      outletId: opname.outletId,
      actorId: actor.id,
      entityType: "stock_opname",
      entityId: opname.id,
    };
    if (withVariance.length === 0) {
      await tx
        .update(stockOpnames)
        .set({ status: "applied", submittedAt: sql`clock_timestamp()`, postedAt: sql`clock_timestamp()` })
        .where(eq(stockOpnames.id, opname.id));
      await recordAudit(
        tx,
        { ...audit, action: "inventory.opname_applied", after: { counted: counted.length, variances: 0 } },
        context,
      );
      return { status: "applied" as const, approvalId: null };
    }

    const [approval] = await tx
      .insert(approvals)
      .values({
        companyId: opname.companyId,
        brandId: opname.brandId,
        outletId: opname.outletId,
        type: "stock_opname",
        referenceId: opname.id,
        reason: `Stock opname: ${withVariance.length} item selisih dari ${counted.length} item dihitung`,
        requestedBy: actor.id,
      })
      .returning({ id: approvals.id });
    await tx
      .update(stockOpnames)
      .set({ status: "submitted", approvalId: approval.id, submittedAt: sql`clock_timestamp()` })
      .where(eq(stockOpnames.id, opname.id));
    await recordAudit(
      tx,
      {
        ...audit,
        action: "inventory.opname_submitted",
        after: { counted: counted.length, variances: withVariance.length, approvalId: approval.id },
      },
      context,
    );
    return { status: "submitted" as const, approvalId: approval.id };
  });
}

/**
 * Posting opname yang disetujui. Selisih (actual − snapshot) diterapkan ke
 * saldo SAAT INI, sehingga movement yang terjadi setelah snapshot (mis.
 * penjualan) tidak hilang. Satu kali saja: status + idempotency key per item.
 */
async function decideOpname(
  tx: DbExecutor,
  actor: CurrentUser,
  approval: ApprovalRow,
  approve: boolean,
  context: AuditContext,
) {
  const opname = await lockOpname(tx, actor, approval.referenceId);
  if (opname.status !== "submitted" || opname.approvalId !== approval.id) {
    throw new AccessError("conflict", "Opname ini tidak sedang menunggu persetujuan.");
  }
  const audit = {
    companyId: opname.companyId,
    brandId: opname.brandId,
    outletId: opname.outletId,
    actorId: actor.id,
    entityType: "stock_opname",
    entityId: opname.id,
  };
  if (!approve) {
    await tx.update(stockOpnames).set({ status: "rejected" }).where(eq(stockOpnames.id, opname.id));
    await recordAudit(tx, { ...audit, action: "inventory.opname_rejected", after: { approvalId: approval.id } }, context);
    return { menuBrandId: null };
  }

  const rows = await tx
    .select({ itemId: stockOpnameItems.itemId, variance: stockOpnameItems.variance, reason: stockOpnameItems.reason })
    .from(stockOpnameItems)
    .where(and(eq(stockOpnameItems.opnameId, opname.id), ne(stockOpnameItems.variance, "0")))
    .orderBy(asc(stockOpnameItems.itemId));

  const posted: PostedMovement[] = [];
  for (const row of rows) {
    const variance = qtyFromDb(row.variance);
    if (variance === 0n) continue;
    posted.push(
      await postMovement(tx, {
        itemId: row.itemId,
        type: "opname",
        quantity: variance,
        idempotencyKey: `opname:${opname.id}:${row.itemId}`,
        actorId: actor.id,
        reason: row.reason,
        referenceType: "stock_opname",
        referenceId: opname.id,
        allowInactive: true,
      }),
    );
  }
  await tx
    .update(stockOpnames)
    .set({ status: "applied", postedAt: sql`clock_timestamp()` })
    .where(eq(stockOpnames.id, opname.id));
  await recordAudit(
    tx,
    {
      ...audit,
      action: "inventory.opname_applied",
      after: {
        approvalId: approval.id,
        items: posted.map((m) => ({ itemId: m.itemId, name: m.name, before: qtyToString(m.before), after: qtyToString(m.after) })),
      },
    },
    context,
  );
  return { menuBrandId: posted.some(crossedZero) ? opname.brandId : null };
}

export async function cancelOpname(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(opnameRefInput, raw);
  return db.transaction(async (tx) => {
    const opname = await lockOpname(tx, actor, input.opnameId);
    assertInventory(actor, "inventory.opname", opname.outletId);
    if (opname.status !== "draft") {
      throw new AccessError("conflict", "Hanya opname draft yang bisa dibatalkan.");
    }
    await tx.update(stockOpnames).set({ status: "cancelled" }).where(eq(stockOpnames.id, opname.id));
    await recordAudit(
      tx,
      {
        companyId: opname.companyId,
        brandId: opname.brandId,
        outletId: opname.outletId,
        actorId: actor.id,
        action: "inventory.opname_cancelled",
        entityType: "stock_opname",
        entityId: opname.id,
      },
      context,
    );
    return { cancelled: true };
  });
}
