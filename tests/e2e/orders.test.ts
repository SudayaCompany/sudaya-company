import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { orders } from "@/db/schema";
import {
  createCategory,
  createModifierGroup,
  createProduct,
  setProductAvailability,
} from "@/lib/catalog/admin-ops";
import { loadStorefront } from "@/lib/catalog/storefront";

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
  return { status: res.status, body: await res.text() };
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
  return { headers: res.headers, body: await res.text() };
}

/** Ambil objek hasil action (baris RSC "1:{...}") dari respons. */
function actionResult(body: string) {
  const line = body.split("\n").find((l) => /^1:\{/.test(l));
  return line ? JSON.parse(line.slice(2)) : null;
}

describe.skipIf(!hasLiveEnv)("transaksi end-to-end (POS, QR, kiosk, KDS)", () => {
  let ctx: LiveContext;
  let company: TestCompany;
  let cashier: TestUser;
  let barista: TestUser;
  let owner: TestUser;
  let cashierCookie: string;
  let baristaCookie: string;
  let latteId: string;
  let largeId: string;
  let soldOutId: string;

  const ORDER_ACTIONS = "src/lib/orders/actions.ts";
  /** Device id test sendiri → key rate limit-nya bisa dihapus persis saat cleanup. */
  const newDevice = () => {
    const id = randomBytes(16).toString("base64url");
    for (const prefix of ["checkout:device:", "checkout-replay:device:"]) ctx.trackRateLimitKey(`${prefix}${id}`);
    return `sdy_did=${id}`;
  };
  let guestDevice: string;

  const checkout = (overrides: Record<string, unknown> = {}) => ({
    idempotencyKey: randomUUID(),
    type: "dine_in",
    customerName: "Andi E2E",
    tableNumber: "T03",
    paymentMethod: "cash",
    lines: [{ productId: latteId, modifierIds: [largeId], quantity: 2, notes: "Less sugar" }],
    ...overrides,
  });
  /** Checkout guest lewat Route Handler POST /api/orders (rate limit + 429). */
  const place = async (input: Record<string, unknown>, channel = "qr_table", device = guestDevice) => {
    const res = await fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: device },
      body: JSON.stringify({ outlet: company.outletCode, channel, checkout: input }),
    });
    return { status: res.status, headers: res.headers, body: await res.json() };
  };
  const guestCookie = (headers: Headers) =>
    headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("sdy_order_"));

  beforeAll(async () => {
    ctx = createLiveContext();
    company = await ctx.createCompany("e2eord");
    for (const prefix of ["checkout:outlet:", "checkout-replay:outlet:"]) ctx.trackRateLimitKey(`${prefix}${company.outletCode}`);
    guestDevice = newDevice();
    const admin = await ctx.createUser(company, [{ role: "super_admin" }]);
    cashier = await ctx.createUser(company, [{ role: "cashier", outlet: "outlet" }], { withPassword: true, fullName: "E2E Kasir" });
    barista = await ctx.createUser(company, [{ role: "barista", outlet: "outlet" }], { withPassword: true, fullName: "E2E Barista" });
    owner = await ctx.createUser(company, [{ role: "owner" }], { withPassword: true });
    cashierCookie = (await signInWithCookies(cashier.email, cashier.password!)).cookieHeader();
    baristaCookie = (await signInWithCookies(barista.email, barista.password!)).cookieHeader();

    const a = admin.current;
    const coffee = (await createCategory(ctx.db, a, company.brandId, { name: "Coffee" }, audit))!.id;
    const size = await createModifierGroup(ctx.db, a, company.brandId, {
      name: "Size", selection: "single", isRequired: true, minSelect: 1, maxSelect: 1,
      options: [{ name: "Regular", priceDelta: 0, isDefault: true }, { name: "Large", priceDelta: 6000 }],
    }, audit);
    latteId = (await createProduct(ctx.db, a, company.brandId, { name: "Iced Latte", categoryId: coffee, basePrice: "25000", isActive: true, modifierGroupIds: [size.id] }, null, audit, noStorage))!.id;
    soldOutId = (await createProduct(ctx.db, a, company.brandId, { name: "Americano", categoryId: coffee, basePrice: "20000", isActive: true, modifierGroupIds: [] }, null, audit, noStorage))!.id;
    await setProductAvailability(ctx.db, a, { productId: soldOutId, outletId: company.outletId, isAvailable: false }, audit);
    const storefront = (await loadStorefront(ctx.db, company.outletCode))!;
    largeId = storefront.products.find((p) => p.id === latteId)!.groups[0].modifiers.find((m) => m.name === "Large")!.id;
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });

  describe("customer guest (QR)", () => {
    let orderId: string;
    let cookie: string;

    it("checkout tanpa login: harga dari server, cookie token httpOnly", async () => {
      const res = await place({
        ...checkout(),
        total: 1,
        lines: [{ productId: latteId, modifierIds: [largeId], quantity: 2, unitPrice: 1, notes: "Less sugar" }],
      });
      expect(res.status).toBe(201);
      const result = res.body;
      expect(result).toMatchObject({ ok: true, total: 62000 });
      orderId = result.orderId;
      cookie = guestCookie(res.headers)!;
      expect(cookie).toBeTruthy();
      const raw = res.headers.getSetCookie().find((c) => c.startsWith("sdy_order_"))!;
      expect(raw).toMatch(/HttpOnly/i);
      expect(raw).toMatch(/Path=\/order\/status/);
      const [row] = await ctx.db.select().from(orders).where(eq(orders.id, orderId));
      expect(row).toMatchObject({ channel: "qr_table", tableNumber: "T03", total: 62000, status: "pending_payment" });
      // Token tidak muncul di body respons.
      expect(JSON.stringify(res.body)).not.toContain(cookie.split("=")[1]);
      expect(res.headers.get("cache-control")).toContain("no-store");
    });

    it("halaman status hanya terbuka dengan cookie milik order tsb", async () => {
      const page = await get(`/order/status/${orderId}`, cookie);
      expect(page.body).toContain("Menunggu pembayaran");
      expect(page.body).toContain("Andi E2E");
      expect(page.body).toContain('content="no-referrer"');
      expect((await get(`/order/status/${orderId}`)).body).toContain("Pesanan tidak ditemukan");
      const other = await place(checkout());
      const otherCookie = guestCookie(other.headers)!.replace(/^sdy_order_\w+/, `sdy_order_${orderId.replace(/-/g, "")}`);
      expect((await get(`/order/status/${orderId}`, otherCookie)).body).toContain("Pesanan tidak ditemukan");
    });

    it("order belum dibayar tidak tampil di KDS", async () => {
      const kds = await get(`/kds`, baristaCookie);
      expect(kds.body).toContain("Antrean FIFO");
      expect(kds.body).not.toContain("Andi E2E");
    });

    it("kasir konfirmasi cash → nomor antrean; status customer & KDS ikut berubah", async () => {
      const res = await callAction(`/pos/orders/${orderId}`, actionId(ORDER_ACTIONS, "confirmCashAction"), [{ orderId, tenderedAmount: 100000 }], cashierCookie);
      const result = actionResult(res.body);
      expect(result.ok).toBe(true);
      const orderNumber = result.data.orderNumber as string;
      expect(orderNumber).toMatch(/^SDY-\d{3}$/);

      const status = await get(`/order/status/${orderId}`, cookie);
      expect(status.body).toContain(orderNumber);
      expect(status.body).toContain("Pesanan diterima");
      const kds = await get(`/kds`, baristaCookie);
      expect(kds.body).toContain(orderNumber);
      expect(kds.body).toContain("Less sugar");

      // Retry/double payment tidak menerbitkan nomor kedua.
      const again = actionResult((await callAction(`/pos/orders/${orderId}`, actionId(ORDER_ACTIONS, "confirmCashAction"), [{ orderId, tenderedAmount: 100000 }], cashierCookie)).body);
      expect(again.data.orderNumber).toBe(orderNumber);
    });

    it("barista memproses di KDS; kasir tanpa izin ditolak; customer melihat progres", async () => {
      const update = (from: string, to: string, cookieHeader: string) =>
        callAction("/kds", actionId(ORDER_ACTIONS, "updateOrderStatusAction"), [{ orderId, from, to }], cookieHeader);
      expect(isForbidden((await get("/kds", cashierCookie)).body)).toBe(true);
      expect(actionResult((await update("queued", "preparing", cashierCookie)).body)).toMatchObject({ ok: false });

      expect(actionResult((await update("queued", "preparing", baristaCookie)).body)).toMatchObject({ ok: true });
      expect((await get(`/order/status/${orderId}`, cookie)).body).toContain("Sedang dibuat");
      expect(actionResult((await update("preparing", "ready", baristaCookie)).body)).toMatchObject({ ok: true });
      expect((await get(`/order/status/${orderId}`, cookie)).body).toContain("Siap diambil");
      // Klik ganda dengan status lama ditolak.
      expect(actionResult((await update("preparing", "ready", baristaCookie)).body)).toMatchObject({ ok: false });
    });

    it("validasi: sold out, idempotency, & delivery", async () => {
      const soldOut = (await place(checkout({ lines: [{ productId: soldOutId, modifierIds: [], quantity: 1 }] }))).body;
      expect(soldOut).toMatchObject({ ok: false });
      expect(soldOut.error).toContain("Maaf, produk ini baru saja tidak tersedia.");

      const input = checkout();
      const [x, y] = await Promise.all([place(input), place(input)]);
      expect(x.body.orderId).toBe(y.body.orderId);
      expect([x.status, y.status].sort()).toEqual([200, 201]);
      const rows = await ctx.db.select().from(orders).where(eq(orders.idempotencyKey, input.idempotencyKey));
      expect(rows).toHaveLength(1);

      const delivery = (await place(checkout({ type: "delivery", tableNumber: undefined }), "website")).body;
      expect(delivery).toMatchObject({ ok: false });
      expect(delivery.error).toMatch(/Nomor HP wajib|Alamat/);
    });
  });

  it("kiosk: order masuk engine yang sama tanpa menyimpan token di perangkat", async () => {
    const res = await place(checkout({ type: "takeaway", tableNumber: undefined }), "kiosk", newDevice());
    const result = res.body;
    expect(result).toMatchObject({ ok: true, total: 62000 });
    expect(guestCookie(res.headers)).toBeUndefined();
    const [row] = await ctx.db.select().from(orders).where(eq(orders.id, result.orderId));
    expect(row.channel).toBe("kiosk");
    const kiosk = await get(`/kiosk?outlet=${company.outletCode}`);
    expect(kiosk.body).toContain("Pesan di sini, bayar di kasir");
    expect(kiosk.body).not.toMatch(/href="\/(admin|staff|pos|kds)/);
  });

  describe("hardening checkout (rate limit)", () => {
    it("17. melewati batas per perangkat → HTTP 429 + Retry-After; retry key sama & perangkat lain tetap jalan", async () => {
      const device = newDevice();
      const first = checkout();
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await place(i === 0 ? first : checkout(), "qr_table", device)).status);
      expect(statuses).toEqual([201, 201, 201, 201, 201, 201]);

      const blocked = await place(checkout(), "qr_table", device);
      expect(blocked.status).toBe(429);
      const retryAfter = Number(blocked.headers.get("retry-after"));
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(600);
      expect(blocked.body).toMatchObject({ ok: false, retryAfter });
      expect(blocked.body.error).toMatch(/Terlalu banyak pesanan/);

      // Retry pesanan yang sudah ada (jaringan putus) tidak memakai kuota.
      const replay = await place(first, "qr_table", device);
      expect(replay.status).toBe(200);
      expect(replay.body.ok).toBe(true);
      // Customer lain di Wi-Fi yang sama tidak ikut terblokir.
      expect((await place(checkout(), "qr_table", newDevice())).status).toBe(201);
    });

    it("request lintas origin / bukan JSON ditolak", async () => {
      const body = JSON.stringify({ outlet: company.outletCode, channel: "qr_table", checkout: checkout() });
      const cross = await fetch(`${BASE}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example", cookie: newDevice() },
        body,
      });
      expect(cross.status).toBe(403);
      const form = await fetch(`${BASE}/api/orders`, { method: "POST", headers: { "Content-Type": "text/plain", cookie: newDevice() }, body });
      expect(form.status).toBe(415);
      // Server Action checkout lama sudah tidak ada (tidak ada jalur tanpa rate limit).
      const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as {
        node: Record<string, { exportedName: string }>;
      };
      expect(Object.values(manifest.node).some((v) => v.exportedName === "placeOrderAction")).toBe(false);
    });

    it("halaman status menampilkan batas waktu bayar", async () => {
      // Perangkat baru: guestDevice sudah memakai kuota checkout di test sebelumnya.
      const res = await place(checkout(), "qr_table", newDevice());
      expect(res.status).toBe(201);
      const cookie = guestCookie(res.headers)!;
      const page = await get(`/order/status/${res.body.orderId}`, cookie);
      expect(page.body).toContain("Bayar sebelum");
      const [row] = await ctx.db.select().from(orders).where(eq(orders.id, res.body.orderId));
      expect(row.expiresAt).not.toBeNull();
    });
  });

  describe("POS", () => {
    it("kasir: buat order + bayar tunai sekaligus, struk bisa dicetak", async () => {
      expect(isForbidden((await get("/pos", cashierCookie)).body)).toBe(false);
      const res = await callAction("/pos", actionId(ORDER_ACTIONS, "posCheckoutAction"), [
        { outletId: company.outletId, tenderedAmount: 50000, checkout: checkout({ customerName: undefined, type: "takeaway", tableNumber: undefined, lines: [{ productId: latteId, modifierIds: [largeId], quantity: 1 }] }) },
      ], cashierCookie);
      const result = actionResult(res.body);
      expect(result).toMatchObject({ ok: true, data: { total: 31000, change: 19000 } });
      expect(result.data.orderNumber).toMatch(/^SDY-\d{3}$/);
      const [row] = await ctx.db.select().from(orders).where(eq(orders.id, result.data.orderId));
      expect(row).toMatchObject({ channel: "pos", createdBy: cashier.id, paymentStatus: "paid", status: "queued" });

      const receipt = await get(`/pos/orders/${result.data.orderId}/receipt`, cashierCookie);
      expect(receipt.body).toContain(result.data.orderNumber);
      expect(receipt.body).toContain("Kembali");
    });

    it("barista: order POS tersimpan belum dibayar (tanpa izin konfirmasi cash)", async () => {
      const res = await callAction("/pos", actionId(ORDER_ACTIONS, "posCheckoutAction"), [
        { outletId: company.outletId, tenderedAmount: 100000, checkout: checkout() },
      ], baristaCookie);
      const result = actionResult(res.body);
      expect(result).toMatchObject({ ok: true, data: { orderNumber: null } });
    });

    it("owner (tanpa order.create) tidak bisa membuka POS tapi bisa melihat riwayat order", async () => {
      const ownerCookie = (await signInWithCookies(owner.email, owner.password!)).cookieHeader();
      expect(isForbidden((await get("/pos", ownerCookie)).body)).toBe(true);
      const list = await get("/admin/orders?q=Andi", ownerCookie);
      expect(isForbidden(list.body)).toBe(false);
      expect(list.body).toContain("Andi E2E");
      const res = await callAction("/pos", actionId(ORDER_ACTIONS, "posCheckoutAction"), [
        { outletId: company.outletId, tenderedAmount: null, checkout: checkout() },
      ], ownerCookie);
      expect(actionResult(res.body)).toMatchObject({ ok: false });
    });
  });
});
