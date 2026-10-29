import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  approvals,
  auditLogs,
  inventoryItems,
  inventoryTransactions,
  orders,
  outletProducts,
  outlets,
  payments,
  stockOpnameItems,
  stockOpnames,
} from "@/db/schema";
import { AccessError } from "@/lib/auth/errors";
import {
  createCategory,
  createProduct,
  listProducts,
  productListParams,
  setProductAvailability,
} from "@/lib/catalog/admin-ops";
import { quoteCart } from "@/lib/catalog/quote";
import { loadStorefront } from "@/lib/catalog/storefront";
import type { EvidenceStorage } from "@/lib/inventory/evidence";
import {
  createItem,
  createOpname,
  decideStockApproval,
  recordStockIn,
  recordStockOut,
  requestAdjustment,
  requestReversal,
  saveOpnameCounts,
  setItemProducts,
  submitOpname,
  updateItem,
} from "@/lib/inventory/ops";
import { listItems, listMovements, wasteSummary } from "@/lib/inventory/queries";
import { checkoutRules } from "@/lib/orders/checkout-limits";
import { businessDateIn } from "@/lib/orders/dates";
import {
  cancelOrder,
  confirmCashPayment,
  createOrder,
  decideCancellation,
  getKdsBoard,
} from "@/lib/orders/engine";
import { consumeRateLimits } from "@/lib/security/rate-limit";

import { TINY_PNG, createLiveContext, hasLiveEnv, type LiveContext, type TestCompany, type TestUser } from "../helpers/live";

const audit = { ip: "127.0.0.1", userAgent: "vitest" };
const noMenuStorage = { upload: async () => {}, remove: async () => {} };

async function expectAccessError(promise: Promise<unknown>, code: AccessError["code"], message?: RegExp) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error, "harus AccessError").toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
  if (message) expect((error as AccessError).message).toMatch(message);
}

/** Error Postgres (Drizzle membungkusnya; pesan asli ada di `cause`). */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error, "harus gagal").toBeTruthy();
  const messages: string[] = [];
  for (let e = error as { message?: string; cause?: unknown } | undefined, i = 0; e && i < 4; e = e.cause as typeof e, i++) {
    messages.push(String(e.message ?? ""));
    const constraint = (e as { constraint_name?: string }).constraint_name;
    if (constraint) messages.push(constraint);
  }
  expect(messages.join(" | ")).toMatch(pattern);
}

/** Storage bukti palsu (in-memory) — tidak menyentuh Supabase Storage. */
function memoryStorage() {
  const files = new Map<string, number>();
  const storage: EvidenceStorage = {
    upload: async (path, bytes) => void files.set(path, bytes.length),
    remove: async (paths) => paths.forEach((p) => files.delete(p)),
    signedUrl: async (path) => `memory://${path}`,
  };
  return { files, storage };
}

describe.skipIf(!hasLiveEnv)("inventory, ledger & hardening order (DB live)", () => {
  let ctx: LiveContext;
  let A: TestCompany;
  let B: TestCompany;
  let superA: TestUser;
  let adminA: TestUser;
  let managerA: TestUser;
  let manager2A: TestUser;
  let baristaA: TestUser;
  let cashierA: TestUser;
  let superB: TestUser;
  let latteId: string;
  let bottleProductId: string;
  const evidence = memoryStorage();
  const today = businessDateIn("Asia/Jakarta");

  const newItem = async (sku: string, unit: string, extra: Record<string, unknown> = {}) =>
    (await createItem(
      ctx.db,
      superA.current,
      { outletId: A.outletId, sku: `${sku}-${ctx.runId}`, name: `${sku} test`, kind: "raw_material", unit, ...extra },
      audit,
    ))!.id;
  const stockIn = (actor: TestUser, itemId: string, quantity: string, unit: string, extra: Record<string, unknown> = {}) =>
    recordStockIn(
      ctx.db,
      actor.current,
      { idempotencyKey: randomUUID(), itemId, type: "purchase", quantity, unit, effectiveDate: today, ...extra },
      audit,
    );
  const stockOut = (
    actor: TestUser,
    itemId: string,
    quantity: string,
    unit: string,
    reason = "internal_use",
    extra: Record<string, unknown> = {},
    photo: Parameters<typeof recordStockOut>[3] = null,
  ) =>
    recordStockOut(
      ctx.db,
      actor.current,
      { idempotencyKey: randomUUID(), itemId, reason, quantity, unit, ...extra },
      photo,
      evidence.storage,
      audit,
    );
  const stockOf = async (itemId: string) =>
    Number((await ctx.db.select({ q: inventoryItems.stockQty }).from(inventoryItems).where(eq(inventoryItems.id, itemId)))[0].q);
  const ledgerOf = (itemId: string) =>
    ctx.db
      .select()
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.itemId, itemId))
      .orderBy(asc(inventoryTransactions.createdAt));
  /** Saldo cache harus selalu = jumlah seluruh ledger. */
  const expectLedgerConsistent = async (itemId: string) => {
    const [row] = await ctx.db
      .select({ sum: sql<string>`coalesce(sum(${inventoryTransactions.quantity}), 0)` })
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.itemId, itemId));
    expect(Number(row.sum)).toBe(await stockOf(itemId));
  };
  const decide = (actor: TestUser, approvalId: string, approve: boolean) =>
    decideStockApproval(ctx.db, actor.current, { approvalId, approve }, audit);

  beforeAll(async () => {
    ctx = createLiveContext();
    A = await ctx.createCompany("inva");
    B = await ctx.createCompany("invb");
    superA = await ctx.createUser(A, [{ role: "super_admin" }]);
    adminA = await ctx.createUser(A, [{ role: "admin", outlet: "outlet" }]);
    managerA = await ctx.createUser(A, [{ role: "manager", outlet: "outlet" }]);
    manager2A = await ctx.createUser(A, [{ role: "manager", outlet: "outlet" }]);
    baristaA = await ctx.createUser(A, [{ role: "barista", outlet: "outlet" }]);
    cashierA = await ctx.createUser(A, [{ role: "cashier", outlet: "outlet" }]);
    superB = await ctx.createUser(B, [{ role: "super_admin" }]);

    const category = (await createCategory(ctx.db, superA.current, A.brandId, { name: "Menu" }, audit))!.id;
    const product = (name: string, price: number) =>
      createProduct(
        ctx.db,
        superA.current,
        A.brandId,
        { name, categoryId: category, basePrice: String(price), isActive: true, modifierGroupIds: [] },
        null,
        audit,
        noMenuStorage,
      ).then((p) => p!.id);
    latteId = await product("Iced Latte", 25000);
    bottleProductId = await product("Cold Brew Bottle", 30000);
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });

  describe("ledger stok", () => {
    let milk: string;

    beforeAll(async () => {
      milk = await newItem("MILK", "ml", { minimumStock: "500" });
    });

    it("1. stok masuk menambah saldo (konversi l → ml, harga pokok per ml)", async () => {
      const result = await stockIn(managerA, milk, "1,5", "l", { unitCost: "18500", documentRef: "INV-001" });
      expect(result).toMatchObject({ balance: "1500", unit: "ml", replayed: false });
      expect(await stockOf(milk)).toBe(1500);
      const [row] = await ledgerOf(milk);
      expect(row).toMatchObject({ type: "purchase", quantity: "1500.000", balanceAfter: "1500.000", documentRef: "INV-001", createdBy: managerA.id });
      expect(Number(row.unitCost)).toBe(18.5);
      const [item] = await ctx.db.select().from(inventoryItems).where(eq(inventoryItems.id, milk));
      expect(Number(item.purchasePrice)).toBe(18.5);
      expect(await ctx.countAudit(A.id, "inventory.stock_in", milk)).toBe(1);
      // Satuan beda dimensi / tidak tepat ditolak.
      await expectAccessError(stockIn(managerA, milk, "1", "kg"), "invalid", /tidak bisa dikonversi/);
      await expectAccessError(stockIn(managerA, milk, "0.0000001", "l"), "invalid", /presisi/);
      await expectAccessError(stockIn(managerA, milk, "0", "ml"), "invalid");
    });

    it("2. stok keluar mengurangi saldo", async () => {
      const result = await stockOut(baristaA, milk, "250", "ml");
      expect(result.balance).toBe("1250");
      const rows = await ledgerOf(milk);
      expect(rows.at(-1)).toMatchObject({ type: "internal_use", quantity: "-250.000", balanceAfter: "1250.000" });
      // Harga pokok saat itu ikut tercatat untuk nilai keluar.
      expect(Number(rows.at(-1)!.unitCost)).toBe(18.5);
      expect(await ctx.countAudit(A.id, "inventory.stock_out", milk)).toBe(1);
    });

    it("3. movement tidak bisa diposting dua kali (idempotency key)", async () => {
      const input = { idempotencyKey: randomUUID(), itemId: milk, type: "purchase", quantity: "100", unit: "ml", effectiveDate: today };
      const before = await stockOf(milk);
      const results = await Promise.all([
        recordStockIn(ctx.db, managerA.current, input, audit),
        recordStockIn(ctx.db, managerA.current, input, audit),
        recordStockIn(ctx.db, managerA.current, input, audit),
      ]);
      expect(new Set(results.map((r) => r.movementId)).size).toBe(1);
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      expect(await stockOf(milk)).toBe(before + 100);
      const rows = await ctx.db
        .select()
        .from(inventoryTransactions)
        .where(and(eq(inventoryTransactions.outletId, A.outletId), eq(inventoryTransactions.idempotencyKey, `stock-in:${input.idempotencyKey}`)));
      expect(rows).toHaveLength(1);
    });

    it("4. movement bersamaan tetap konsisten (row lock)", async () => {
      const before = await stockOf(milk);
      await Promise.all([
        ...Array.from({ length: 6 }, () => stockOut(baristaA, milk, "10", "ml")),
        ...Array.from({ length: 4 }, () => stockIn(managerA, milk, "20", "ml")),
      ]);
      expect(await stockOf(milk)).toBe(before - 60 + 80);
      await expectLedgerConsistent(milk);
      // balance_after membentuk rantai tanpa celah (tidak ada lost update).
      const rows = await ledgerOf(milk);
      let running = 0;
      for (const row of [...rows].sort((a, b) => +a.createdAt - +b.createdAt)) {
        running += Number(row.quantity);
        expect(Number(row.balanceAfter)).toBe(running);
      }
    });

    it("5. saldo negatif ditolak — termasuk saat bersamaan & langsung di DB", async () => {
      const current = await stockOf(milk);
      await expectAccessError(stockOut(baristaA, milk, String(current + 1), "ml"), "conflict", /tidak cukup/);
      expect(await stockOf(milk)).toBe(current);

      const drain = await newItem("DRAIN", "g");
      await stockIn(managerA, drain, "1000", "g");
      const settled = await Promise.allSettled(Array.from({ length: 3 }, () => stockOut(baristaA, drain, "400", "g")));
      expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(2);
      expect(await stockOf(drain)).toBe(200);

      // Pengaman database: CHECK constraint & ledger append-only.
      await expectDbError(ctx.db.update(inventoryItems).set({ stockQty: "-1" }).where(eq(inventoryItems.id, drain)), /stock_non_negative/);
      const [first] = await ledgerOf(drain);
      await expectDbError(
        ctx.db.update(inventoryTransactions).set({ quantity: "999" }).where(eq(inventoryTransactions.id, first.id)),
        /append-only/,
      );
      await expectDbError(ctx.db.delete(inventoryTransactions).where(eq(inventoryTransactions.id, first.id)), /append-only/);
      await expectLedgerConsistent(drain);
    });

    it("6. koreksi hanya lewat reversal (approval Manager, four-eyes)", async () => {
      const item = await newItem("REV", "g");
      const wrong = await stockIn(adminA, item, "500", "g");
      const { approvalId } = await requestReversal(ctx.db, adminA.current, { movementId: wrong.movementId, reason: "Salah input jumlah" }, audit);
      // Belum disetujui → stok belum berubah.
      expect(await stockOf(item)).toBe(500);
      await expectAccessError(requestReversal(ctx.db, adminA.current, { movementId: wrong.movementId, reason: "Salah input lagi" }, audit), "conflict", /menunggu/);
      // Admin tidak punya approval.approve; pengaju tidak boleh memutuskan sendiri.
      await expectAccessError(decide(adminA, approvalId, true), "forbidden");

      await decide(managerA, approvalId, true);
      expect(await stockOf(item)).toBe(0);
      const rows = await ledgerOf(item);
      expect(rows).toHaveLength(2);
      const original = rows.find((r) => r.id === wrong.movementId)!;
      expect(original).toMatchObject({ quantity: "500.000", balanceAfter: "500.000" }); // baris asal tidak diubah
      expect(rows.find((r) => r.type === "reversal")).toMatchObject({ quantity: "-500.000", reversesId: wrong.movementId, balanceAfter: "0.000" });
      await expectAccessError(requestReversal(ctx.db, adminA.current, { movementId: wrong.movementId, reason: "Sekali lagi" }, audit), "conflict", /sudah pernah dibalik/);
      expect(await ctx.countAudit(A.id, "inventory.reversal_posted", item)).toBe(1);

      // Koreksi manual: ditolak → stok tetap; disetujui ganda bersamaan → satu posting.
      await stockIn(managerA, item, "100", "g");
      const rejected = await requestAdjustment(ctx.db, adminA.current, { itemId: item, direction: "out", quantity: "30", unit: "g", reason: "Selisih timbangan" }, audit);
      await decide(managerA, rejected.approvalId, false);
      expect(await stockOf(item)).toBe(100);
      const adj = await requestAdjustment(ctx.db, adminA.current, { itemId: item, direction: "out", quantity: "30", unit: "g", reason: "Selisih timbangan" }, audit);
      const decisions = await Promise.allSettled([decide(managerA, adj.approvalId, true), decide(manager2A, adj.approvalId, true)]);
      expect(decisions.filter((d) => d.status === "fulfilled")).toHaveLength(1);
      expect(await stockOf(item)).toBe(70);
      await expectAccessError(decide(managerA, adj.approvalId, true), "conflict", /sudah diputuskan/);
      expect((await ledgerOf(item)).filter((r) => r.type === "adjustment_out")).toHaveLength(1);
      await expectLedgerConsistent(item);
    });
  });

  describe("stock opname", () => {
    let flour: string;
    let cups: string;
    let opnameId: string;
    let approvalId: string;

    beforeAll(async () => {
      flour = await newItem("FLOUR", "g", { openingStock: "1000" });
      cups = await newItem("CUP", "pcs", { kind: "packaging", openingStock: "50" });
    });

    it("7. snapshot & variance dihitung server", async () => {
      const created = (await createOpname(ctx.db, adminA.current, { outletId: A.outletId, notes: "Opname test" }, audit))!;
      opnameId = created.id;
      // Satu sesi terbuka per outlet.
      await expectAccessError(createOpname(ctx.db, adminA.current, { outletId: A.outletId }, audit), "conflict", /belum selesai/);

      await saveOpnameCounts(ctx.db, adminA.current, {
        opnameId,
        counts: [
          { itemId: flour, actualQty: "970" },
          { itemId: cups, actualQty: "52" },
        ],
      }, audit);
      const rows = await ctx.db.select().from(stockOpnameItems).where(eq(stockOpnameItems.opnameId, opnameId));
      expect(rows.find((r) => r.itemId === flour)).toMatchObject({ systemQty: "1000.000", actualQty: "970.000", variance: "-30.000" });
      expect(rows.find((r) => r.itemId === cups)).toMatchObject({ systemQty: "50.000", actualQty: "52.000", variance: "2.000" });
      // Jumlah pecahan untuk satuan hitung ditolak.
      await expectAccessError(saveOpnameCounts(ctx.db, adminA.current, { opnameId, counts: [{ itemId: cups, actualQty: "1.5" }] }, audit), "invalid", /bilangan bulat/);
      // Selisih wajib beralasan.
      await expectAccessError(submitOpname(ctx.db, adminA.current, { opnameId }, audit), "invalid", /alasan selisih/);
    });

    it("8. approval opname: belum disetujui tidak mengubah stok; disetujui sekali; memperhitungkan mutasi setelah snapshot", async () => {
      await saveOpnameCounts(ctx.db, adminA.current, {
        opnameId,
        counts: [
          { itemId: flour, actualQty: "970", reason: "Tumpah saat produksi" },
          { itemId: cups, actualQty: "52", reason: "Salah hitung sebelumnya" },
        ],
      }, audit);
      const submitted = await submitOpname(ctx.db, adminA.current, { opnameId }, audit);
      expect(submitted.status).toBe("submitted");
      approvalId = submitted.approvalId!;
      expect(await stockOf(flour)).toBe(1000);
      expect(await stockOf(cups)).toBe(50);

      // Mutasi setelah snapshot: 100 g terpakai.
      await stockOut(baristaA, flour, "100", "g");
      await expectAccessError(decide(adminA, approvalId, true), "forbidden");

      const decisions = await Promise.allSettled([decide(managerA, approvalId, true), decide(manager2A, approvalId, true)]);
      expect(decisions.filter((d) => d.status === "fulfilled")).toHaveLength(1);
      await expectAccessError(decide(managerA, approvalId, true), "conflict");
      // Selisih (−30) diterapkan ke saldo terkini (900), bukan menimpa ke 970.
      expect(await stockOf(flour)).toBe(870);
      expect(await stockOf(cups)).toBe(52);
      const opnameMovements = await ctx.db
        .select()
        .from(inventoryTransactions)
        .where(and(eq(inventoryTransactions.referenceType, "stock_opname"), eq(inventoryTransactions.referenceId, opnameId)));
      expect(opnameMovements).toHaveLength(2);
      const [opname] = await ctx.db.select().from(stockOpnames).where(eq(stockOpnames.id, opnameId));
      expect(opname.status).toBe("applied");
      expect(opname.postedAt).not.toBeNull();
      expect(await ctx.countAudit(A.id, "inventory.opname_applied", opnameId)).toBe(1);
      await expectLedgerConsistent(flour);
    });

    it("opname ditolak tidak mengubah stok; tanpa selisih selesai tanpa approval", async () => {
      const rejected = (await createOpname(ctx.db, adminA.current, { outletId: A.outletId }, audit))!.id;
      await saveOpnameCounts(ctx.db, adminA.current, { opnameId: rejected, counts: [{ itemId: cups, actualQty: "40", reason: "Hilang" }] }, audit);
      const sub = await submitOpname(ctx.db, adminA.current, { opnameId: rejected }, audit);
      await decide(managerA, sub.approvalId!, false);
      expect(await stockOf(cups)).toBe(52);
      expect((await ctx.db.select().from(stockOpnames).where(eq(stockOpnames.id, rejected)))[0].status).toBe("rejected");

      const clean = (await createOpname(ctx.db, adminA.current, { outletId: A.outletId }, audit))!.id;
      await saveOpnameCounts(ctx.db, adminA.current, { opnameId: clean, counts: [{ itemId: cups, actualQty: "52" }] }, audit);
      const done = await submitOpname(ctx.db, adminA.current, { opnameId: clean }, audit);
      expect(done).toEqual({ status: "applied", approvalId: null });
      expect(await stockOf(cups)).toBe(52);
    });
  });

  it("9. waste tercatat dengan alasan, foto bukti, nilai dari harga pokok", async () => {
    const beans = await newItem("BEAN", "g");
    await stockIn(managerA, beans, "1", "kg", { unitCost: "200000" }); // Rp 200/g
    const photo = { bytes: TINY_PNG, ext: "png", contentType: "image/png" };
    const result = await stockOut(baristaA, beans, "50", "g", "spilled", { notes: "Jatuh saat grinding" }, photo);
    expect(result.balance).toBe("950");
    const [row] = (await ledgerOf(beans)).filter((r) => r.type === "waste");
    expect(row.reason).toBe("Tumpah: Jatuh saat grinding");
    expect(row.photoPath).toMatch(new RegExp(`^${A.id}/${A.outletId}/[0-9a-f-]+\\.png$`));
    expect(evidence.files.has(row.photoPath!)).toBe(true);
    expect(await ctx.countAudit(A.id, "inventory.waste", beans)).toBe(1);

    const summary = await wasteSummary(ctx.db, managerA.current, A.outletId, {});
    const line = summary.byItem.find((i) => i.itemId === beans)!;
    expect(line).toMatchObject({ events: 1, value: 10000, uncosted: 0 });
    expect(Number(line.quantity)).toBe(50);
    expect(summary.byReason.find((r) => r.label === "Tumpah")).toBeTruthy();

    // Transaksi gagal (stok kurang) → foto yang terlanjur diunggah dihapus lagi.
    const before = evidence.files.size;
    await expectAccessError(stockOut(baristaA, beans, "5000", "g", "damaged", {}, photo), "conflict");
    expect(evidence.files.size).toBe(before);
    // "Lainnya" wajib catatan.
    await expectAccessError(stockOut(baristaA, beans, "1", "g", "other_waste"), "invalid", /catatan/);
  });

  it("10. data outlet/company lain tidak bisa diubah atau dilihat", async () => {
    const item = await newItem("ISO", "g");
    // Company lain.
    await expectAccessError(stockIn(superB, item, "1", "g"), "not_found");
    await expectAccessError(stockOut(superB, item, "1", "g"), "not_found");
    await expectAccessError(listItems(ctx.db, superB.current, A.outletId, { status: "all", page: 1 }), "not_found");
    // Outlet lain di company yang sama: admin outlet-scoped ditolak.
    const [outlet2] = await ctx.db
      .insert(outlets)
      .values({ companyId: A.id, brandId: A.brandId, code: `T${ctx.runId}INV2`.toUpperCase(), name: "Outlet 2" })
      .returning({ id: outlets.id });
    const other = (await createItem(ctx.db, superA.current, { outletId: outlet2.id, sku: "O2", name: "Outlet2 item", kind: "raw_material", unit: "g" }, audit))!.id;
    await expectAccessError(stockIn(adminA, other, "1", "g"), "forbidden");
    await expectAccessError(createItem(ctx.db, adminA.current, { outletId: outlet2.id, sku: "X", name: "Xx", kind: "raw_material", unit: "g" }, audit), "forbidden");
    await expectAccessError(listMovements(ctx.db, adminA.current, outlet2.id, { page: 1 }), "forbidden");
    // SKU unik per outlet (outlet lain boleh sama).
    await expectAccessError(createItem(ctx.db, superA.current, { outletId: outlet2.id, sku: "o2", name: "Duplikat", kind: "raw_material", unit: "g" }, audit), "conflict", /SKU/);
  });

  it("11. aksi tanpa izin ditolak sesuai permission", async () => {
    const item = await newItem("PERM", "g", { openingStock: "100" });
    await expectAccessError(stockIn(cashierA, item, "1", "g"), "forbidden");
    await expectAccessError(stockOut(cashierA, item, "1", "g"), "forbidden");
    await expectAccessError(listItems(ctx.db, cashierA.current, A.outletId, { status: "all", page: 1 }), "forbidden");
    // Barista: boleh stok keluar/waste, tidak boleh stok masuk / koreksi / opname / master.
    await expect(stockOut(baristaA, item, "1", "g")).resolves.toBeTruthy();
    await expectAccessError(stockIn(baristaA, item, "1", "g"), "forbidden");
    await expectAccessError(requestAdjustment(ctx.db, baristaA.current, { itemId: item, direction: "in", quantity: "5", unit: "g", reason: "Coba-coba" }, audit), "forbidden");
    await expectAccessError(createOpname(ctx.db, baristaA.current, { outletId: A.outletId }, audit), "forbidden");
    await expectAccessError(updateItem(ctx.db, baristaA.current, { itemId: item, name: "Diubah", kind: "raw_material", isActive: true }, audit), "forbidden");
    const req = await requestAdjustment(ctx.db, adminA.current, { itemId: item, direction: "in", quantity: "5", unit: "g", reason: "Barang ditemukan" }, audit);
    await expectAccessError(decide(baristaA, req.approvalId, true), "forbidden");
    await expectAccessError(decide(cashierA, req.approvalId, false), "forbidden");
    await decide(managerA, req.approvalId, false);
  });

  describe("integrasi menu & order", () => {
    let bottle: string;
    const checkout = (lines: { productId: string; quantity: number }[]) => ({
      idempotencyKey: randomUUID(),
      type: "takeaway",
      customerName: "Inv",
      paymentMethod: "cash",
      lines: lines.map((l) => ({ ...l, modifierIds: [] })),
    });
    const guest = (lines: { productId: string; quantity: number }[]) =>
      createOrder(ctx.db, { channel: "qr_table", outlet: { code: A.outletCode }, actor: null, input: checkout(lines) }, audit);
    const pay = (orderId: string) => confirmCashPayment(ctx.db, cashierA.current, { orderId, tenderedAmount: 500_000 }, audit);
    const available = async (productId: string) =>
      (await loadStorefront(ctx.db, A.outletCode))!.products.find((p) => p.id === productId)!.isAvailable;

    beforeAll(async () => {
      bottle = await newItem("CBB", "botol", { kind: "finished_good", minimumStock: "1", openingStock: "3" });
      await setItemProducts(ctx.db, superA.current, { itemId: bottle, productIds: [bottleProductId] }, audit);
    });

    it("12. produk jadi berkurang saat dibayar dan otomatis sold out saat stok 0", async () => {
      expect(await available(bottleProductId)).toBe(true);
      // Stok tidak cukup ditolak saat quote & checkout (tanpa menebak stok di browser).
      const quote = quoteCart((await loadStorefront(ctx.db, A.outletCode, { withStock: true }))!, [{ productId: bottleProductId, modifierIds: [], quantity: 4 }]);
      expect(quote.ok && quote.lines[0]).toMatchObject({ ok: false, error: "Stok tersisa 3. Kurangi jumlahnya." });
      await expectAccessError(guest([{ productId: bottleProductId, quantity: 4 }]), "invalid", /Stok tersisa 3/);

      const first = await guest([{ productId: bottleProductId, quantity: 2 }]);
      expect(await stockOf(bottle)).toBe(3); // belum dibayar → stok belum dipotong
      const paid = await pay(first.orderId);
      expect(paid.menuBrandId).toBeNull();
      expect(await stockOf(bottle)).toBe(1);
      const sale = (await ledgerOf(bottle)).find((r) => r.type === "sale")!;
      expect(sale).toMatchObject({ quantity: "-2.000", referenceType: "order", referenceId: first.orderId });
      expect(await ctx.countAudit(A.id, "inventory.sale_posted", first.orderId)).toBe(1);

      // Low stock (stok ≤ minimum) tampil di admin, menu masih tersedia.
      const list = await listProducts(ctx.db, superA.current, A.brandId, A.outletId, productListParams.parse({}));
      expect(list.rows.find((r) => r.id === bottleProductId)).toMatchObject({ isAvailable: true, inventoryUnavailable: false, lowStock: true });

      // Dua order menunggu bayar; stok tinggal 1 → yang kedua gagal dibayar, uang tidak diterima.
      const second = await guest([{ productId: bottleProductId, quantity: 1 }]);
      const third = await guest([{ productId: bottleProductId, quantity: 1 }]);
      const last = await pay(second.orderId);
      expect(last.menuBrandId).toBe(A.brandId); // 1 → 0: katalog perlu di-refresh
      expect(await stockOf(bottle)).toBe(0);
      expect(await available(bottleProductId)).toBe(false);
      await expectAccessError(pay(third.orderId), "conflict", /tidak cukup/);
      const [thirdRow] = await ctx.db.select().from(orders).where(eq(orders.id, third.orderId));
      expect(thirdRow).toMatchObject({ status: "pending_payment", paymentStatus: "pending", orderNumber: null });
      await expectAccessError(guest([{ productId: bottleProductId, quantity: 1 }]), "invalid", /tidak tersedia/);
      // Status manual TIDAK berubah oleh habisnya stok.
      const [link] = await ctx.db.select().from(outletProducts).where(and(eq(outletProducts.outletId, A.outletId), eq(outletProducts.productId, bottleProductId)));
      expect(link).toMatchObject({ isAvailable: true, inventoryItemId: bottle });

      // Pembatalan order lunas (disetujui) mengembalikan stok lewat reversal.
      await cancelOrder(ctx.db, managerA.current, { orderId: second.orderId, reason: "Customer batal" }, audit);
      const [approval] = await ctx.db.select().from(approvals).where(and(eq(approvals.referenceId, second.orderId), eq(approvals.status, "pending")));
      const decided = await decideCancellation(ctx.db, manager2A.current, { approvalId: approval.id, approve: true }, audit);
      expect(decided.menuBrandId).toBe(A.brandId);
      expect(await stockOf(bottle)).toBe(1);
      expect((await ledgerOf(bottle)).find((r) => r.type === "reversal")).toMatchObject({ quantity: "1.000" });
      expect(await available(bottleProductId)).toBe(true);
      await expectLedgerConsistent(bottle);
    });

    it("13. manual sold out dihormati & tidak ditimpa sinkronisasi stok", async () => {
      await setProductAvailability(ctx.db, superA.current, { productId: bottleProductId, outletId: A.outletId, isAvailable: false }, audit);
      expect(await available(bottleProductId)).toBe(false);
      await stockIn(managerA, bottle, "10", "botol");
      expect(await available(bottleProductId)).toBe(false);
      await setItemProducts(ctx.db, superA.current, { itemId: bottle, productIds: [bottleProductId] }, audit);
      const [link] = await ctx.db.select().from(outletProducts).where(and(eq(outletProducts.outletId, A.outletId), eq(outletProducts.productId, bottleProductId)));
      expect(link.isAvailable).toBe(false);
      await expectAccessError(guest([{ productId: bottleProductId, quantity: 1 }]), "invalid", /tidak tersedia/);
      await setProductAvailability(ctx.db, superA.current, { productId: bottleProductId, outletId: A.outletId, isAvailable: true }, audit);
      expect(await available(bottleProductId)).toBe(true);
      // Item nonaktif → produk jadi tidak tersedia.
      await updateItem(ctx.db, superA.current, { itemId: bottle, name: "CBB test", kind: "finished_good", minimumStock: "1", isActive: false }, audit);
      expect(await available(bottleProductId)).toBe(false);
      await updateItem(ctx.db, superA.current, { itemId: bottle, name: "CBB test", kind: "finished_good", minimumStock: "1", isActive: true }, audit);
      // Hanya produk jadi bersatuan hitung yang bisa dihubungkan.
      const milk = await newItem("LINK", "ml");
      await expectAccessError(setItemProducts(ctx.db, superA.current, { itemId: milk, productIds: [latteId] }, audit), "invalid", /produk jadi/);
      await expectAccessError(setItemProducts(ctx.db, baristaA.current, { itemId: bottle, productIds: [bottleProductId] }, audit), "forbidden");
    });

    it("14. bahan baku TIDAK berkurang tanpa BOM (minuman racikan)", async () => {
      const milk = await newItem("RAW", "ml", { openingStock: "2000" });
      const before = await ctx.db.select({ id: inventoryTransactions.id }).from(inventoryTransactions).where(eq(inventoryTransactions.outletId, A.outletId));
      const order = await guest([{ productId: latteId, quantity: 3 }]);
      await pay(order.orderId);
      expect(await stockOf(milk)).toBe(2000);
      const after = await ctx.db.select({ id: inventoryTransactions.id }).from(inventoryTransactions).where(eq(inventoryTransactions.outletId, A.outletId));
      expect(after.length).toBe(before.length);
    });
  });

  describe("kedaluwarsa order belum dibayar", () => {
    const guest = () =>
      createOrder(
        ctx.db,
        {
          channel: "qr_table",
          outlet: { code: A.outletCode },
          actor: null,
          input: { idempotencyKey: randomUUID(), type: "takeaway", customerName: "Exp", paymentMethod: "cash", lines: [{ productId: latteId, modifierIds: [], quantity: 1 }] },
        },
        audit,
      );
    /** Manipulasi khusus test: mundurkan batas bayar order tsb. */
    const backdate = (orderId: string) =>
      ctx.db.update(orders).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(orders.id, orderId));
    const expire = async (orderId: string) => {
      const rows = (await ctx.db.execute(sql`select public.expire_pending_orders(10, ${orderId}::uuid) as n`)) as unknown as { n: number }[];
      return Number(rows[0].n);
    };

    it("batas bayar default 15 menit dari waktu database", async () => {
      const order = await guest();
      const [row] = await ctx.db
        .select({ ttl: sql<number>`extract(epoch from ${orders.expiresAt} - ${orders.createdAt})::int` })
        .from(orders)
        .where(eq(orders.id, order.orderId));
      expect(row.ttl).toBe(15 * 60);
    });

    it("15. order belum dibayar kedaluwarsa (idempotent, audit, tidak masuk KDS)", async () => {
      const order = await guest();
      await backdate(order.orderId);
      // ≤ 1: pg_cron (tiap menit) bisa saja lebih dulu memprosesnya — hasil akhir sama.
      expect(await expire(order.orderId)).toBeLessThanOrEqual(1);
      expect(await expire(order.orderId)).toBe(0); // dijalankan ulang → tidak berubah lagi
      const [row] = await ctx.db.select().from(orders).where(eq(orders.id, order.orderId));
      expect(row).toMatchObject({ status: "cancelled", paymentStatus: "expired", cancelReason: "Batas waktu pembayaran habis" });
      const [payment] = await ctx.db.select().from(payments).where(eq(payments.orderId, order.orderId));
      expect(payment.status).toBe("expired");
      const logs = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, order.orderId), eq(auditLogs.action, "order.expired")));
      expect(logs).toHaveLength(1);
      expect(logs[0].actorId).toBeNull();
      const board = await getKdsBoard(ctx.db, baristaA.current, A.outletId);
      expect(board.orders.find((o) => o.id === order.orderId)).toBeUndefined();
      await expectAccessError(confirmCashPayment(ctx.db, cashierA.current, { orderId: order.orderId, tenderedAmount: 100_000 }, audit), "conflict", /Batas waktu/);
    });

    it("kasir membayar order yang sudah lewat batas (cron belum jalan) → ditolak & langsung kedaluwarsa", async () => {
      const order = await guest();
      await backdate(order.orderId);
      await expectAccessError(confirmCashPayment(ctx.db, cashierA.current, { orderId: order.orderId, tenderedAmount: 100_000 }, audit), "conflict", /Batas waktu/);
      const [row] = await ctx.db.select().from(orders).where(eq(orders.id, order.orderId));
      expect(row).toMatchObject({ status: "cancelled", paymentStatus: "expired", orderNumber: null });
    });

    it("16. order yang sudah dibayar tidak pernah kedaluwarsa; pembayaran yang sedang berjalan tidak diganggu", async () => {
      const paidOrder = await guest();
      await confirmCashPayment(ctx.db, cashierA.current, { orderId: paidOrder.orderId, tenderedAmount: 100_000 }, audit);
      await backdate(paidOrder.orderId);
      expect(await expire(paidOrder.orderId)).toBe(0);
      const [paidRow] = await ctx.db.select().from(orders).where(eq(orders.id, paidOrder.orderId));
      expect(paidRow).toMatchObject({ status: "queued", paymentStatus: "paid" });

      // Race: baris dikunci transaksi pembayaran → fungsi expiry melewatinya (SKIP LOCKED).
      const racing = await guest();
      await backdate(racing.orderId);
      await ctx.db.transaction(async (tx) => {
        await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, racing.orderId)).for("update");
        expect(await expire(racing.orderId)).toBe(0); // koneksi lain
      });
    });
  });

  describe("17. rate limit checkout", () => {
    const key = (name: string) => {
      const k = `test-${ctx.runId}:${name}:${randomUUID()}`;
      ctx.trackRateLimitKey(k);
      return k;
    };

    it("counter atomik: melewati batas → ditolak dengan retry-after", async () => {
      const k = key("basic");
      const rule = [{ key: k, limit: 3, windowSeconds: 60 }];
      const results = await Promise.all(Array.from({ length: 5 }, () => consumeRateLimits(ctx.db, rule)));
      expect(results.filter((r) => r.ok)).toHaveLength(3);
      const blocked = results.find((r) => !r.ok)!;
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) {
        expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
        expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
      }
    });

    it("window berakhir → kuota pulih", async () => {
      const rule = [{ key: key("window"), limit: 1, windowSeconds: 1 }];
      expect((await consumeRateLimits(ctx.db, rule)).ok).toBe(true);
      expect((await consumeRateLimits(ctx.db, rule)).ok).toBe(false);
      await new Promise((r) => setTimeout(r, 1500));
      expect((await consumeRateLimits(ctx.db, rule)).ok).toBe(true);
    });

    it("perangkat dibatasi ketat; perangkat lain di Wi-Fi yang sama tetap bisa memesan", async () => {
      const ip = `198.51.100.${Math.floor(Math.random() * 200)}`;
      const rules = (deviceId: string) =>
        checkoutRules({ channel: "qr_table", outletCode: `T${ctx.runId}`, deviceId: `${ctx.runId}-${deviceId}`, ip, replay: false }).map((r) => {
          ctx.trackRateLimitKey(r.key);
          return r;
        });
      const phone = randomUUID();
      const attempts = [];
      for (let i = 0; i < 7; i++) attempts.push(await consumeRateLimits(ctx.db, rules(phone)));
      expect(attempts.slice(0, 6).every((r) => r.ok)).toBe(true);
      expect(attempts[6].ok).toBe(false);
      // Customer lain (perangkat berbeda, IP sama) tidak ikut terblokir.
      expect((await consumeRateLimits(ctx.db, rules(randomUUID()))).ok).toBe(true);
    });
  });
});
