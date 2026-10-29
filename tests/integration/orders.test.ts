import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { approvals, orderItemModifiers, orderItems, orders, payments } from "@/db/schema";
import { AccessError } from "@/lib/auth/errors";
import {
  createCategory,
  createModifierGroup,
  createProduct,
  setProductActive,
  setProductAvailability,
} from "@/lib/catalog/admin-ops";
import {
  cancelOrder,
  confirmCashPayment,
  createOrder,
  decideCancellation,
  getGuestOrder,
  getKdsBoard,
  getOrderDetail,
  listOrders,
  orderListParams,
  updateOrderStatus,
} from "@/lib/orders/engine";
import { outletOrdersTopic } from "@/lib/orders/realtime";
import { orderReference } from "@/lib/orders/state";
import { hashAccessToken } from "@/lib/orders/tokens";

import {
  createLiveContext,
  hasLiveEnv,
  type LiveContext,
  type TestCompany,
  type TestUser,
} from "../helpers/live";

const audit = { ip: "127.0.0.1", userAgent: "vitest" };
const noStorage = { upload: async () => {}, remove: async () => {} };

async function expectAccessError(promise: Promise<unknown>, code: AccessError["code"], message?: RegExp) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
  if (message) expect((error as AccessError).message).toMatch(message);
}

describe.skipIf(!hasLiveEnv)("order engine (DB live)", () => {
  let ctx: LiveContext;
  let A: TestCompany;
  let B: TestCompany;
  let adminA: TestUser;
  let cashierA: TestUser;
  let baristaA: TestUser;
  let managerA: TestUser;
  let superB: TestUser;
  let latteId: string;
  let teaId: string;
  let soldOutId: string;
  let inactiveId: string;
  let regularId: string;
  let largeId: string;

  /** Input checkout minimal; harga TIDAK pernah dikirim (dan diabaikan bila ada). */
  const checkout = (overrides: Record<string, unknown> = {}) => ({
    idempotencyKey: randomUUID(),
    type: "takeaway",
    customerName: "Andi",
    paymentMethod: "cash",
    lines: [{ productId: latteId, modifierIds: [largeId], quantity: 2 }],
    ...overrides,
  });
  const guestOrder = (overrides: Record<string, unknown> = {}, channel: "qr_table" | "kiosk" | "website" = "qr_table") =>
    createOrder(ctx.db, { channel, outlet: { code: A.outletCode }, actor: null, input: checkout(overrides) }, audit);
  const pay = (orderId: string, tenderedAmount = 100_000, actor = cashierA) =>
    confirmCashPayment(ctx.db, actor.current, { orderId, tenderedAmount }, audit);

  beforeAll(async () => {
    ctx = createLiveContext();
    A = await ctx.createCompany("orda");
    B = await ctx.createCompany("ordb");
    adminA = await ctx.createUser(A, [{ role: "super_admin" }]);
    cashierA = await ctx.createUser(A, [{ role: "cashier", outlet: "outlet" }]);
    baristaA = await ctx.createUser(A, [{ role: "barista", outlet: "outlet" }]);
    managerA = await ctx.createUser(A, [{ role: "manager", outlet: "outlet" }]);
    superB = await ctx.createUser(B, [{ role: "super_admin" }]);

    const a = adminA.current;
    const coffee = (await createCategory(ctx.db, a, A.brandId, { name: "Coffee" }, audit))!.id;
    const size = await createModifierGroup(ctx.db, a, A.brandId, {
      name: "Size", selection: "single", isRequired: true, minSelect: 1, maxSelect: 1,
      options: [{ name: "Regular", priceDelta: 0, isDefault: true }, { name: "Large", priceDelta: 6000 }],
    }, audit);
    const product = (name: string, price: number, groups: string[] = []) =>
      createProduct(ctx.db, a, A.brandId, { name, categoryId: coffee, basePrice: String(price), isActive: true, modifierGroupIds: groups }, null, audit, noStorage).then((p) => p!.id);
    latteId = await product("Iced Latte", 25000, [size.id]);
    teaId = await product("Iced Tea", 15000);
    soldOutId = await product("Americano", 20000);
    inactiveId = await product("Mocha", 30000);
    await setProductAvailability(ctx.db, a, { productId: soldOutId, outletId: A.outletId, isAvailable: false }, audit);
    await setProductActive(ctx.db, a, { productId: inactiveId, isActive: false }, audit);

    const storefront = (await import("@/lib/catalog/storefront")).loadStorefront;
    const latte = (await storefront(ctx.db, A.outletCode))!.products.find((p) => p.id === latteId)!;
    regularId = latte.groups[0].modifiers.find((m) => m.name === "Regular")!.id;
    largeId = latte.groups[0].modifiers.find((m) => m.name === "Large")!.id;
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });

  describe("membuat order (semua channel memakai engine yang sama)", () => {
    it("guest QR: harga dihitung server, snapshot item & modifier tersimpan", async () => {
      const created = await guestOrder({
        lines: [
          // Field harga dari "browser" diabaikan.
          { productId: latteId, modifierIds: [largeId], quantity: 2, unitPrice: 1, lineTotal: 2, notes: "Less ice" },
          { productId: teaId, modifierIds: [], quantity: 1 },
        ],
        total: 1,
        subtotal: 1,
      });
      expect(created.replayed).toBe(false);
      expect(created.total).toBe((25000 + 6000) * 2 + 15000);
      expect(created.accessToken).toMatch(/^[\w-]{40,}$/);

      const [row] = await ctx.db.select().from(orders).where(eq(orders.id, created.orderId));
      expect(row).toMatchObject({
        channel: "qr_table", status: "pending_payment", paymentStatus: "pending",
        subtotal: 77000, total: 77000, queueNumber: null, orderNumber: null, companyId: A.id,
      });
      // Token asli tidak disimpan, hanya hash.
      expect(row.accessTokenHash).toBe(hashAccessToken(created.accessToken!));

      const items = await ctx.db.select().from(orderItems).where(eq(orderItems.orderId, created.orderId));
      const latte = items.find((i) => i.productId === latteId)!;
      expect(latte).toMatchObject({ productName: "Iced Latte", unitPrice: 25000, modifiersTotal: 6000, lineTotal: 62000, notes: "Less ice" });
      const mods = await ctx.db.select().from(orderItemModifiers).where(eq(orderItemModifiers.orderItemId, latte.id));
      expect(mods).toEqual([expect.objectContaining({ groupName: "Size", modifierName: "Large", priceDelta: 6000 })]);

      const [payment] = await ctx.db.select().from(payments).where(eq(payments.orderId, created.orderId));
      expect(payment).toMatchObject({ method: "cash", status: "pending", amount: 77000 });
      expect(await ctx.countAudit(A.id, "order.created", created.orderId)).toBe(1);
    });

    it("POS (barista) dan kiosk memakai engine yang sama", async () => {
      const pos = await createOrder(ctx.db, { channel: "pos", outlet: { id: A.outletId }, actor: baristaA.current, input: checkout({ customerName: undefined }) }, audit);
      const kiosk = await guestOrder({}, "kiosk");
      const rows = await ctx.db.select({ id: orders.id, channel: orders.channel, createdBy: orders.createdBy, accessTokenHash: orders.accessTokenHash }).from(orders).where(eq(orders.companyId, A.id));
      expect(rows.find((r) => r.id === pos.orderId)).toMatchObject({ channel: "pos", createdBy: baristaA.id, accessTokenHash: null });
      expect(rows.find((r) => r.id === kiosk.orderId)).toMatchObject({ channel: "kiosk", createdBy: null });
      expect(pos.accessToken).toBeNull();
    });

    it("double click / retry dengan idempotency key sama → satu order", async () => {
      const input = checkout();
      const [first, second] = await Promise.all([
        createOrder(ctx.db, { channel: "website", outlet: { code: A.outletCode }, actor: null, input }, audit),
        createOrder(ctx.db, { channel: "website", outlet: { code: A.outletCode }, actor: null, input }, audit),
      ]);
      expect(first.orderId).toBe(second.orderId);
      expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
      const rows = await ctx.db.select().from(orders).where(eq(orders.idempotencyKey, input.idempotencyKey));
      expect(rows).toHaveLength(1);
      const paymentRows = await ctx.db.select().from(payments).where(eq(payments.orderId, first.orderId));
      expect(paymentRows).toHaveLength(1);
      // Retry menerbitkan token baru; token lama tidak berlaku lagi.
      const retry = await createOrder(ctx.db, { channel: "website", outlet: { code: A.outletCode }, actor: null, input }, audit);
      expect(await getGuestOrder(ctx.db, first.orderId, retry.accessToken!)).not.toBeNull();
    });

    it("produk/modifier tidak valid ditolak", async () => {
      await expectAccessError(guestOrder({ lines: [{ productId: soldOutId, modifierIds: [], quantity: 1 }] }), "invalid", /baru saja tidak tersedia/);
      await expectAccessError(guestOrder({ lines: [{ productId: inactiveId, modifierIds: [], quantity: 1 }] }), "invalid", /tidak lagi tersedia/);
      await expectAccessError(guestOrder({ lines: [{ productId: latteId, modifierIds: [], quantity: 1 }] }), "invalid", /Pilih Size/);
      await expectAccessError(guestOrder({ lines: [{ productId: teaId, modifierIds: [largeId], quantity: 1 }] }), "invalid", /tidak valid/);
      await expectAccessError(guestOrder({ lines: [{ productId: latteId, modifierIds: [regularId, largeId], quantity: 1 }] }), "invalid");
      await expectAccessError(guestOrder({ lines: [{ productId: teaId, modifierIds: [], quantity: 0 }] }), "invalid");
      await expectAccessError(guestOrder({ lines: [] }), "invalid", /kosong/);
    });

    it("aturan tipe order, identitas, & metode pembayaran", async () => {
      await expectAccessError(guestOrder({ type: "delivery", customerPhone: "081234567890" }), "invalid", /Alamat/);
      await expectAccessError(guestOrder({ type: "delivery", deliveryAddress: "Jl. Merdeka No. 10, Bandung" }), "invalid", /Nomor HP wajib/);
      await expectAccessError(guestOrder({ customerName: "" }), "invalid", /Nama pemesan/);
      await expectAccessError(guestOrder({ customerPhone: "12345" }), "invalid", /Nomor HP tidak valid/);
      await expectAccessError(guestOrder({ paymentMethod: "qris" }), "invalid", /online belum tersedia/);
      const delivery = await guestOrder({ type: "delivery", customerPhone: "+62 812-3456-7890", deliveryAddress: "Jl. Merdeka No. 10, Bandung", tableNumber: "T9" });
      const [row] = await ctx.db.select().from(orders).where(eq(orders.id, delivery.orderId));
      expect(row).toMatchObject({ customerPhone: "081234567890", tableNumber: null, type: "delivery" });
    });

    it("channel POS wajib staf berizin & outlet company sendiri", async () => {
      await expectAccessError(createOrder(ctx.db, { channel: "pos", outlet: { id: A.outletId }, actor: null, input: checkout() }, audit), "unauthenticated");
      await expectAccessError(createOrder(ctx.db, { channel: "pos", outlet: { id: A.outletId }, actor: superB.current, input: checkout() }, audit), "not_found");
      await expectAccessError(createOrder(ctx.db, { channel: "pos", outlet: { code: B.outletCode }, actor: baristaA.current, input: checkout() }, audit), "not_found");
    });
  });

  describe("pembayaran cash & nomor antrean", () => {
    it("order belum dibayar tidak masuk KDS; setelah dibayar masuk", async () => {
      const created = await guestOrder();
      let board = await getKdsBoard(ctx.db, baristaA.current, A.outletId);
      expect(board.orders.some((o) => o.id === created.orderId)).toBe(false);

      const paid = await pay(created.orderId, 70000);
      expect(paid).toMatchObject({ alreadyPaid: false, change: 70000 - 62000 });
      expect(paid.orderNumber).toMatch(/^SDY-\d{3}$/);

      board = await getKdsBoard(ctx.db, baristaA.current, A.outletId);
      const card = board.orders.find((o) => o.id === created.orderId)!;
      expect(card).toMatchObject({ status: "queued", orderNumber: paid.orderNumber, customerName: "Andi" });
      expect(card.lines[0].modifiers[0].name).toBe("Large");
      expect(await ctx.countAudit(A.id, "payment.confirmed", created.orderId)).toBe(1);
      expect(await ctx.countAudit(A.id, "order.queued", created.orderId)).toBe(1);
    });

    it("pembayaran bersamaan → nomor antrean unik & berurutan sesuai waktu bayar", async () => {
      const created = await Promise.all(Array.from({ length: 6 }, () => guestOrder()));
      const results = await Promise.all(created.map((c) => pay(c.orderId)));
      const numbers = results.map((r) => r.orderNumber);
      expect(new Set(numbers).size).toBe(6);

      const rows = await ctx.db
        .select({ queueNumber: orders.queueNumber, paidAt: orders.paidAt })
        .from(orders)
        .where(and(eq(orders.companyId, A.id), eq(orders.paymentStatus, "paid")));
      const sorted = [...rows].sort((x, y) => x.queueNumber! - y.queueNumber!);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].queueNumber).toBe(sorted[i - 1].queueNumber! + 1);
        expect(sorted[i].paidAt!.getTime()).toBeGreaterThanOrEqual(sorted[i - 1].paidAt!.getTime());
      }
    });

    it("double payment → satu pembayaran & satu nomor antrean", async () => {
      const created = await guestOrder();
      const [x, y] = await Promise.all([pay(created.orderId), pay(created.orderId)]);
      expect([x.alreadyPaid, y.alreadyPaid].sort()).toEqual([false, true]);
      expect(x.orderNumber).toBe(y.orderNumber);
      const paid = await ctx.db.select().from(payments).where(and(eq(payments.orderId, created.orderId), eq(payments.status, "paid")));
      expect(paid).toHaveLength(1);
      // Retry setelah lunas tetap idempotent.
      expect((await pay(created.orderId)).alreadyPaid).toBe(true);
    });

    it("barista tanpa payment.confirm_cash ditolak; uang kurang ditolak", async () => {
      const created = await guestOrder();
      await expectAccessError(pay(created.orderId, 100_000, baristaA), "forbidden");
      await expectAccessError(pay(created.orderId, 1000), "invalid", /kurang/);
      await expectAccessError(pay(created.orderId, 100_000, superB), "not_found");
    });
  });

  describe("status produksi (KDS)", () => {
    let orderId: string;
    beforeAll(async () => {
      orderId = (await guestOrder()).orderId;
      await pay(orderId);
    });

    it("barista: queued → preparing → ready → completed, tercatat audit", async () => {
      const move = (from: string, to: string, actor = baristaA) =>
        updateOrderStatus(ctx.db, actor.current, { orderId, from, to }, audit);
      await move("queued", "preparing");
      // Double click (status lama) ditolak, bukan melompati tahap.
      await expectAccessError(move("queued", "preparing"), "conflict");
      await expectAccessError(move("preparing", "ready", cashierA), "forbidden");
      await move("preparing", "ready");
      // Override mundur butuh kds.manage.
      await expectAccessError(move("ready", "preparing"), "forbidden");
      await move("ready", "preparing", managerA);
      expect(await ctx.countAudit(A.id, "order.status_override", orderId)).toBe(1);
      await move("preparing", "ready");
      await move("ready", "completed");
      // Order selesai tidak bisa kembali diproduksi.
      await expectAccessError(move("completed", "preparing", managerA), "invalid");
      const [row] = await ctx.db.select().from(orders).where(eq(orders.id, orderId));
      expect(row.preparingAt && row.readyAt && row.completedAt).toBeTruthy();
      for (const action of ["order.preparing", "order.ready", "order.completed"]) {
        expect(await ctx.countAudit(A.id, action, orderId)).toBeGreaterThanOrEqual(1);
      }
    });

    it("kasir tanpa kds.view tidak bisa membuka papan KDS", async () => {
      await expectAccessError(getKdsBoard(ctx.db, cashierA.current, A.outletId), "forbidden");
      await expectAccessError(getKdsBoard(ctx.db, superB.current, A.outletId), "not_found");
    });

    it("order belum dibayar tidak bisa diproduksi", async () => {
      const unpaid = await guestOrder();
      await expectAccessError(
        updateOrderStatus(ctx.db, baristaA.current, { orderId: unpaid.orderId, from: "pending_payment", to: "preparing" }, audit),
        "invalid",
      );
    });
  });

  describe("pembatalan", () => {
    it("order belum dibayar langsung batal & tidak bisa dibayar/diproduksi", async () => {
      const created = await guestOrder();
      expect((await cancelOrder(ctx.db, baristaA.current, { orderId: created.orderId, reason: "Customer batal" }, audit)).result).toBe("cancelled");
      const [row] = await ctx.db.select().from(orders).where(eq(orders.id, created.orderId));
      expect(row).toMatchObject({ status: "cancelled", paymentStatus: "expired", cancelReason: "Customer batal" });
      await expectAccessError(pay(created.orderId), "conflict");
      await expectAccessError(cancelOrder(ctx.db, baristaA.current, { orderId: created.orderId, reason: "lagi" }, audit), "conflict");
      await expectAccessError(cancelOrder(ctx.db, cashierA.current, { orderId: created.orderId, reason: "x" }, audit), "invalid");
    });

    it("order lunas butuh approval Manager; uang tidak otomatis kembali", async () => {
      const created = await guestOrder();
      await pay(created.orderId);
      const requested = await cancelOrder(ctx.db, baristaA.current, { orderId: created.orderId, reason: "Salah input" }, audit);
      expect(requested.result).toBe("approval_requested");
      await expectAccessError(cancelOrder(ctx.db, baristaA.current, { orderId: created.orderId, reason: "Salah input" }, audit), "conflict");

      const [approval] = await ctx.db.select().from(approvals).where(eq(approvals.referenceId, created.orderId));
      await expectAccessError(decideCancellation(ctx.db, baristaA.current, { approvalId: approval.id, approve: true }, audit), "forbidden");
      await decideCancellation(ctx.db, managerA.current, { approvalId: approval.id, approve: true, note: "OK" }, audit);
      await expectAccessError(decideCancellation(ctx.db, managerA.current, { approvalId: approval.id, approve: true }, audit), "conflict");

      const [row] = await ctx.db.select().from(orders).where(eq(orders.id, created.orderId));
      expect(row).toMatchObject({ status: "cancelled", paymentStatus: "paid" });
      // Tidak bisa diproduksi lagi.
      await expectAccessError(
        updateOrderStatus(ctx.db, baristaA.current, { orderId: created.orderId, from: "queued", to: "preparing" }, audit),
        "conflict",
      );
      expect(await ctx.countAudit(A.id, "approval.approved", created.orderId)).toBe(1);
    });

    it("pemohon tidak bisa menyetujui pengajuannya sendiri", async () => {
      const created = await guestOrder();
      await pay(created.orderId);
      await cancelOrder(ctx.db, managerA.current, { orderId: created.orderId, reason: "Duplikat" }, audit);
      const [approval] = await ctx.db.select().from(approvals).where(eq(approvals.referenceId, created.orderId));
      await expectAccessError(decideCancellation(ctx.db, managerA.current, { approvalId: approval.id, approve: true }, audit), "forbidden", /sendiri/);
      await decideCancellation(ctx.db, adminA.current, { approvalId: approval.id, approve: false, note: "Tidak valid" }, audit);
      const [row] = await ctx.db.select().from(orders).where(eq(orders.id, created.orderId));
      expect(row.status).toBe("queued");
    });
  });

  describe("akses guest & scope", () => {
    it("guest hanya bisa melihat order miliknya, data publik saja", async () => {
      const mine = await guestOrder({ customerPhone: "081234567890" });
      const other = await guestOrder();
      const view = await getGuestOrder(ctx.db, mine.orderId, mine.accessToken!);
      expect(view).toMatchObject({ reference: orderReference(mine.orderId), status: "pending_payment", total: 62000 });
      expect(view).not.toHaveProperty("customerPhone");
      expect(view).not.toHaveProperty("accessTokenHash");
      expect(view).not.toHaveProperty("companyId");
      expect(await getGuestOrder(ctx.db, mine.orderId, other.accessToken!)).toBeNull();
      expect(await getGuestOrder(ctx.db, mine.orderId, "salah")).toBeNull();
      expect(await getGuestOrder(ctx.db, mine.orderId, undefined)).toBeNull();
    });

    it("company lain tidak bisa melihat/mengubah order", async () => {
      const created = await guestOrder();
      await expectAccessError(getOrderDetail(ctx.db, superB.current, created.orderId), "not_found");
      await expectAccessError(updateOrderStatus(ctx.db, superB.current, { orderId: created.orderId, from: "queued", to: "preparing" }, audit), "not_found");
      const list = await listOrders(ctx.db, superB.current, orderListParams.parse({}));
      expect(list.rows.some((r) => r.id === created.orderId)).toBe(false);
    });

    it("riwayat & filter order (admin)", async () => {
      const created = await guestOrder({ customerName: "Siti Filter" });
      await pay(created.orderId);
      const detail = await getOrderDetail(ctx.db, adminA.current, created.orderId);
      expect(detail.history.map((h) => h.action)).toEqual(["order.created", "payment.confirmed", "order.queued"]);
      expect(detail).not.toHaveProperty("accessTokenHash");
      const byRef = await listOrders(ctx.db, adminA.current, orderListParams.parse({ q: orderReference(created.orderId) }));
      expect(byRef.rows.map((r) => r.id)).toEqual([created.orderId]);
      const active = await listOrders(ctx.db, adminA.current, orderListParams.parse({ status: "active", channel: "qr_table", q: "Siti" }));
      expect(active.rows.map((r) => r.id)).toEqual([created.orderId]);
      // Kasir (outlet) boleh lihat order outletnya; barista juga punya order.view.
      expect((await getOrderDetail(ctx.db, cashierA.current, created.orderId)).id).toBe(created.orderId);
    });
  });

  it("realtime: konfirmasi pembayaran memicu sinyal di topik outlet (tanpa data)", async () => {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false },
    });
    const received: unknown[] = [];
    const channel = client
      .channel(outletOrdersTopic(A.outletId), { config: { private: false } })
      .on("broadcast", { event: "changed" }, (message) => received.push(message.payload));
    await new Promise<void>((resolve) => channel.subscribe((s) => s === "SUBSCRIBED" && resolve()));
    const created = await guestOrder();
    await pay(created.orderId);
    for (let i = 0; i < 40 && received.length < 2; i++) await new Promise((r) => setTimeout(r, 250));
    await client.removeAllChannels();
    expect(received.length).toBeGreaterThanOrEqual(2);
    // Payload hanya id pesan bawaan Realtime — tanpa data order.
    for (const payload of received) {
      expect(Object.keys(payload as object).filter((k) => k !== "id")).toEqual([]);
    }
  });
});
