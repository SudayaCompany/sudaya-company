import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { approvals, inventoryItems } from "@/db/schema";
import { createCategory, createProduct } from "@/lib/catalog/admin-ops";
import { createItem, setItemProducts } from "@/lib/inventory/ops";

import {
  createLiveContext,
  hasLiveEnv,
  signInWithCookies,
  type LiveContext,
  type TestCompany,
  type TestUser,
} from "../helpers/live";
import { E2E_PORT } from "./global-setup";

const BASE = `http://localhost:${E2E_PORT}`;
const audit = { ip: "127.0.0.1", userAgent: "vitest" };
const noStorage = { upload: async () => {}, remove: async () => {} };
const isForbidden = (body: string) => /<meta name="robots" content="noindex"/.test(body);

async function get(path: string, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.text(), headers: res.headers };
}

function actionId(filename: string, exportedName: string) {
  const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as {
    node: Record<string, { filename: string; exportedName: string }>;
  };
  const entry = Object.entries(manifest.node).find(([, v]) => v.filename === filename && v.exportedName === exportedName);
  if (!entry) throw new Error(`action ${exportedName} tidak ditemukan`);
  return entry[0];
}

async function callAction(path: string, id: string, args: unknown[], cookie?: string) {
  const headers: Record<string, string> = {
    "Next-Action": id,
    Accept: "text/x-component",
    Origin: BASE,
    "Content-Type": "text/plain;charset=UTF-8",
  };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE}${path}`, { method: "POST", redirect: "manual", headers, body: JSON.stringify(args) });
  const body = await res.text();
  const line = body.split("\n").find((l) => /^1:\{/.test(l));
  return line ? JSON.parse(line.slice(2)) : null;
}

const INVENTORY_ACTIONS = "src/lib/inventory/actions.ts";
const ORDER_ACTIONS = "src/lib/orders/actions.ts";

describe.skipIf(!hasLiveEnv)("inventory end-to-end (halaman, action, menu)", () => {
  let ctx: LiveContext;
  let company: TestCompany;
  let manager: TestUser;
  let owner: TestUser;
  let barista: TestUser;
  let cashier: TestUser;
  const cookies: Record<string, string> = {};
  let milkId: string;
  let bottleItemId: string;
  const bottleName = "Cold Brew Bottle";

  beforeAll(async () => {
    ctx = createLiveContext();
    company = await ctx.createCompany("e2einv");
    for (const prefix of ["checkout:outlet:", "checkout-replay:outlet:"]) ctx.trackRateLimitKey(`${prefix}${company.outletCode}`);
    const admin = await ctx.createUser(company, [{ role: "super_admin" }]);
    manager = await ctx.createUser(company, [{ role: "manager", outlet: "outlet" }], { withPassword: true, fullName: "E2E Manager" });
    owner = await ctx.createUser(company, [{ role: "owner" }], { withPassword: true, fullName: "E2E Owner" });
    barista = await ctx.createUser(company, [{ role: "barista", outlet: "outlet" }], { withPassword: true, fullName: "E2E Barista" });
    cashier = await ctx.createUser(company, [{ role: "cashier", outlet: "outlet" }], { withPassword: true, fullName: "E2E Kasir" });
    for (const [name, user] of Object.entries({ manager, owner, barista, cashier })) {
      cookies[name] = (await signInWithCookies(user.email, user.password!)).cookieHeader();
    }

    const a = admin.current;
    milkId = (await createItem(ctx.db, a, { outletId: company.outletId, sku: "MILK", name: "Fresh Milk E2E", kind: "raw_material", unit: "ml", minimumStock: "500" }, audit))!.id;
    bottleItemId = (await createItem(ctx.db, a, { outletId: company.outletId, sku: "CBB", name: "Cold Brew Bottle (stok)", kind: "finished_good", unit: "botol", openingStock: "1" }, audit))!.id;
    const category = (await createCategory(ctx.db, a, company.brandId, { name: "Ready to drink" }, audit))!.id;
    const product = (await createProduct(ctx.db, a, company.brandId, { name: bottleName, categoryId: category, basePrice: "30000", isActive: true, modifierGroupIds: [] }, null, audit, noStorage))!.id;
    await setItemProducts(ctx.db, a, { itemId: bottleItemId, productIds: [product] }, audit);
    (globalThis as { bottleProductId?: string }).bottleProductId = product;
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });

  it("11. akses halaman sesuai permission (UI = server)", async () => {
    expect(isForbidden((await get("/admin/inventory", cookies.cashier)).body)).toBe(true);
    const baristaHome = await get("/admin/inventory", cookies.barista);
    expect(isForbidden(baristaHome.body)).toBe(false);
    expect(baristaHome.body).toContain("Fresh Milk E2E");
    // Barista: tab stok masuk tidak tampil & halamannya 403; stok keluar/waste boleh.
    expect(baristaHome.body).not.toContain('href="/admin/inventory/stock-in"');
    expect(isForbidden((await get("/admin/inventory/stock-in", cookies.barista)).body)).toBe(true);
    expect(isForbidden((await get("/admin/inventory/stock-out", cookies.barista)).body)).toBe(false);
    expect(isForbidden((await get("/admin/inventory/waste", cookies.barista)).body)).toBe(false);
    // Owner melihat & menyetujui, tetapi tidak mencatat stok masuk.
    expect(isForbidden((await get("/admin/inventory/opname", cookies.owner)).body)).toBe(false);
    expect(isForbidden((await get("/admin/inventory/stock-in", cookies.owner)).body)).toBe(true);
    // Staff app menautkan modul stok untuk barista.
    expect((await get("/staff", cookies.barista)).body).toContain('href="/admin/inventory"');
    // Tanpa login → redirect login.
    expect((await get("/admin/inventory/items")).status).toBe(307);
  });

  it("stok masuk via Server Action → saldo & ledger tampil; browser tidak bisa mengirim saldo", async () => {
    const result = await callAction("/admin/inventory/stock-in", actionId(INVENTORY_ACTIONS, "stockInAction"), [
      { idempotencyKey: randomUUID(), itemId: milkId, type: "purchase", quantity: "2", unit: "l", effectiveDate: new Date().toISOString().slice(0, 10), unitCost: "18000", stockQty: "999999", balanceAfter: "999999" },
    ], cookies.manager);
    expect(result).toMatchObject({ ok: true, data: { balance: "2000" } });
    const [item] = await ctx.db.select().from(inventoryItems).where(eq(inventoryItems.id, milkId));
    expect(Number(item.stockQty)).toBe(2000);

    const items = await get("/admin/inventory/items?q=Fresh", cookies.manager);
    expect(items.body).toContain("2.000 ml");
    const movements = await get("/admin/inventory/movements", cookies.manager);
    expect(movements.body).toContain("Pembelian");
    expect(movements.body).toContain("E2E Manager");

    // Barista (inventory.issue saja) tidak bisa stok masuk lewat action langsung.
    const denied = await callAction("/admin/inventory/stock-in", actionId(INVENTORY_ACTIONS, "stockInAction"), [
      { idempotencyKey: randomUUID(), itemId: milkId, type: "purchase", quantity: "1", unit: "l", effectiveDate: new Date().toISOString().slice(0, 10) },
    ], cookies.barista);
    expect(denied).toMatchObject({ ok: false });
  });

  it("koreksi: pengaju tidak bisa menyetujui sendiri; approver lain → stok berubah", async () => {
    const request = (cookie: string) =>
      callAction("/admin/inventory/movements", actionId(INVENTORY_ACTIONS, "requestAdjustmentAction"), [
        { itemId: milkId, direction: "out", quantity: "150", unit: "ml", reason: "Selisih timbangan E2E" },
      ], cookie);
    expect(await request(cookies.barista)).toMatchObject({ ok: false });
    expect(await request(cookies.manager)).toMatchObject({ ok: true });
    const [pending] = await ctx.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.companyId, company.id), eq(approvals.type, "stock_adjustment"), eq(approvals.status, "pending")));
    const page = await get("/admin/inventory/movements", cookies.owner);
    expect(page.body).toContain("Menunggu approval");

    const decide = (cookie: string) =>
      callAction("/admin/inventory/movements", actionId(INVENTORY_ACTIONS, "decideStockApprovalAction"), [
        { approvalId: pending.id, approve: true },
      ], cookie);
    const own = await decide(cookies.manager);
    expect(own).toMatchObject({ ok: false });
    expect(own.error).toMatch(/sendiri/);
    expect(await decide(cookies.owner)).toMatchObject({ ok: true });
    expect(await decide(cookies.owner)).toMatchObject({ ok: false });
    const [item] = await ctx.db.select().from(inventoryItems).where(eq(inventoryItems.id, milkId));
    expect(Number(item.stockQty)).toBe(1850);
  });

  it("12. stok produk jadi habis setelah dibayar → menu customer (cache) otomatis sold out", async () => {
    const soldOutLabel = new RegExp(`${bottleName}, Rp\\s?30\\.000, sold out`);
    const menu = () => get(`/order?outlet=${company.outletCode}`);
    expect((await menu()).body).not.toMatch(soldOutLabel);

    const productId = (globalThis as { bottleProductId?: string }).bottleProductId!;
    const device = randomBytes(16).toString("base64url");
    for (const prefix of ["checkout:device:", "checkout-replay:device:"]) ctx.trackRateLimitKey(`${prefix}${device}`);
    const res = await fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `sdy_did=${device}` },
      body: JSON.stringify({
        outlet: company.outletCode,
        channel: "qr_counter",
        checkout: { idempotencyKey: randomUUID(), type: "takeaway", customerName: "Bottle E2E", paymentMethod: "cash", lines: [{ productId, modifierIds: [], quantity: 1 }] },
      }),
    });
    const order = (await res.json()) as { ok: boolean; orderId: string };
    expect(order.ok).toBe(true);
    // Belum dibayar → stok belum berkurang, menu masih tersedia.
    expect((await menu()).body).not.toMatch(soldOutLabel);

    const paid = await callAction(`/pos/orders/${order.orderId}`, actionId(ORDER_ACTIONS, "confirmCashAction"), [
      { orderId: order.orderId, tenderedAmount: 50000 },
    ], cookies.cashier);
    expect(paid).toMatchObject({ ok: true });
    const [item] = await ctx.db.select().from(inventoryItems).where(eq(inventoryItems.id, bottleItemId));
    expect(Number(item.stockQty)).toBe(0);
    expect((await menu()).body).toMatch(soldOutLabel);

    // Admin produk melihat alasan sold out otomatis; dashboard menghitung item habis.
    const products = await get("/admin/products", cookies.manager);
    expect(products.body).toContain("Stok habis — sold out otomatis");
  });

  it("bukti foto hanya lewat route ber-auth (bukan URL publik)", async () => {
    const missing = await get(`/admin/inventory/evidence/${randomUUID()}`, cookies.barista);
    expect(missing.status).toBe(404);
    const anonymous = await get(`/admin/inventory/evidence/${randomUUID()}`);
    expect(anonymous.status).toBe(307);
  });
});
