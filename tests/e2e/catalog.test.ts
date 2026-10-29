import { readFileSync } from "node:fs";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLogs, products } from "@/db/schema";
import { createCategory, createModifierGroup } from "@/lib/catalog/admin-ops";
import { menuImageUrl } from "@/lib/catalog/image-url";

import {
  TINY_PNG,
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
const isForbidden = (body: string) => /<meta name="robots" content="noindex"/.test(body);

async function get(path: string, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.text() };
}

function actionId(filename: string, exportedName: string) {
  const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as {
    node: Record<string, { filename: string; exportedName: string }>;
  };
  const entry = Object.entries(manifest.node).find(
    ([, v]) => v.filename === filename && v.exportedName === exportedName,
  );
  if (!entry) throw new Error(`action ${exportedName} tidak ditemukan`);
  return entry[0];
}

async function callAction(path: string, id: string, body: BodyInit, cookie?: string) {
  const headers: Record<string, string> = { "Next-Action": id, Accept: "text/x-component", Origin: BASE };
  if (typeof body === "string") headers["Content-Type"] = "text/plain;charset=UTF-8";
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE}${path}`, { method: "POST", redirect: "manual", headers, body });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

/** Argumen (prevState, FormData) untuk action useActionState, persis format React. */
function productForm(fields: Record<string, string | string[]>, image?: Blob) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) form.append(`_1_${key}`, v);
  }
  if (image) form.append("_1_image", image, "latte.png");
  form.append("0", JSON.stringify([{}, "$K1"]));
  return form;
}

describe.skipIf(!hasLiveEnv)("katalog end-to-end (HTTP + Server Action)", () => {
  let ctx: LiveContext;
  let company: TestCompany;
  let admin: TestUser;
  let manager: TestUser;
  let barista: TestUser;
  let adminCookie: string;
  let categoryId: string;
  let sizeGroupId: string;
  let productId: string;
  const saveId = () => actionId("src/app/admin/products/actions.ts", "saveProductAction");
  const orderPath = () => `/order?outlet=${company.outletCode}&table=T03`;

  beforeAll(async () => {
    ctx = createLiveContext();
    company = await ctx.createCompany("e2ecat");
    admin = await ctx.createUser(company, [{ role: "admin" }], { withPassword: true, fullName: "E2E Admin Menu" });
    manager = await ctx.createUser(company, [{ role: "manager", outlet: "outlet" }], { withPassword: true });
    barista = await ctx.createUser(company, [{ role: "barista", outlet: "outlet" }], { withPassword: true });
    adminCookie = (await signInWithCookies(admin.email, admin.password!)).cookieHeader();

    categoryId = (await createCategory(ctx.db, admin.current, company.brandId, { name: "Coffee" }, audit))!.id;
    sizeGroupId = (
      await createModifierGroup(ctx.db, admin.current, company.brandId, {
        name: "Size",
        selection: "single",
        isRequired: true,
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: "Regular", priceDelta: 0, isDefault: true },
          { name: "Large", priceDelta: 6000 },
        ],
      }, audit)
    ).id;
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });

  it("guest: katalog kosong menampilkan empty state; outlet tak dikenal ditangani", async () => {
    const empty = await get(orderPath());
    expect(empty.status).toBe(200);
    expect(empty.body).toContain("Menu belum tersedia");
    expect((await get("/order?outlet=TIDAKADA")).body).toContain("Outlet tidak ditemukan");
  });

  it("admin membuat produk + foto lewat Server Action (multipart)", async () => {
    const res = await callAction(
      "/admin/products/new",
      saveId(),
      productForm(
        {
          brandId: company.brandId,
          name: "Iced Caramel Latte",
          sku: "cf-caramel",
          categoryId,
          basePrice: "25000",
          description: "Espresso, susu, karamel.",
          isActive: "true",
          modifierGroupIds: [sizeGroupId],
          // Field liar tidak boleh ikut tersimpan.
          companyId: "00000000-0000-4000-8000-000000000000",
          imagePath: "evil.png",
        },
        new Blob([TINY_PNG], { type: "image/png" }),
      ),
      adminCookie,
    );
    expect(res.headers.get("x-action-redirect") ?? "").toMatch(/^\/admin\/products\?saved=1/);

    const [row] = await ctx.db.select().from(products).where(eq(products.companyId, company.id));
    productId = row.id;
    expect(row).toMatchObject({ name: "Iced Caramel Latte", sku: "CF-CARAMEL", basePrice: 25000 });
    expect(row.imagePath?.startsWith(`${company.id}/${company.brandId}/`)).toBe(true);
    expect((await fetch(menuImageUrl(row.imagePath)!)).status).toBe(200);
  });

  it("admin melihat produk di daftar & halaman edit", async () => {
    const list = await get("/admin/products?q=caramel", adminCookie);
    expect(isForbidden(list.body)).toBe(false);
    expect(list.body).toContain("Iced Caramel Latte");
    expect(list.body).toContain("CF-CARAMEL");
    const edit = await get(`/admin/products/${productId}/edit`, adminCookie);
    expect(edit.body).toContain('value="Iced Caramel Latte"');
    for (const path of ["/admin/categories", "/admin/modifiers", "/admin/products/new"]) {
      expect(isForbidden((await get(path, adminCookie)).body), path).toBe(false);
    }
  });

  it("guest melihat produk, harga, dan nomor meja di /order", async () => {
    const page = await get(orderPath());
    expect(page.body).toContain("Iced Caramel Latte");
    expect(page.body).toContain("Rp 25.000");
    expect(page.body).toContain("Meja");
    expect(page.body).not.toContain("CF-CARAMEL");
  });

  it("quote keranjang dihitung server; harga palsu dari browser diabaikan", async () => {
    const quoteId = actionId("src/app/order/actions.ts", "quoteCartAction");
    const storefront = await get(orderPath());
    // Ambil id opsi "Large" dari payload halaman publik.
    const largeId = /"id":"([0-9a-f-]{36})","name":"Large"/.exec(storefront.body.replace(/\\"/g, '"'))?.[1];
    expect(largeId).toBeTruthy();

    const res = await callAction(
      orderPath(),
      quoteId,
      JSON.stringify([
        {
          outlet: company.outletCode,
          lines: [{ productId, modifierIds: [largeId], quantity: 2, unitPrice: 1, lineTotal: 2 }],
          total: 2,
        },
      ]),
    );
    expect(res.body).toContain('"total":62000');
    expect(res.body).toContain('"unitPrice":31000');
  });

  it("manager menandai sold out → customer langsung melihat Sold out", async () => {
    const managerCookie = (await signInWithCookies(manager.email, manager.password!)).cookieHeader();
    expect(isForbidden((await get("/admin/products", managerCookie)).body)).toBe(false);
    expect(isForbidden((await get("/admin/products/new", managerCookie)).body)).toBe(true);

    const res = await callAction(
      "/admin/products",
      actionId("src/app/admin/products/actions.ts", "setProductAvailabilityAction"),
      JSON.stringify([{ productId, outletId: company.outletId, isAvailable: false }]),
      managerCookie,
    );
    expect(res.body).toContain("Ketersediaan diperbarui.");
    expect((await get(orderPath())).body).toContain("Sold out");

    await callAction(
      "/admin/products",
      actionId("src/app/admin/products/actions.ts", "setProductAvailabilityAction"),
      JSON.stringify([{ productId, outletId: company.outletId, isAvailable: true }]),
      managerCookie,
    );
  });

  it("barista ditolak di halaman & Server Action katalog", async () => {
    const baristaCookie = (await signInWithCookies(barista.email, barista.password!)).cookieHeader();
    expect(isForbidden((await get("/admin/products", baristaCookie)).body)).toBe(true);
    const res = await callAction(
      "/admin/products",
      saveId(),
      productForm({ productId, name: "Diretas", categoryId, basePrice: "1", isActive: "true" }),
      baristaCookie,
    );
    expect(res.body).toContain("tidak memiliki izin");
    const [row] = await ctx.db.select().from(products).where(eq(products.id, productId));
    expect(row.name).toBe("Iced Caramel Latte");
  });

  it("admin mengubah harga → audit price_changed & menu customer ikut berubah", async () => {
    const res = await callAction(
      `/admin/products/${productId}/edit`,
      saveId(),
      productForm({
        productId,
        name: "Iced Caramel Latte",
        slug: "iced-caramel-latte",
        sku: "CF-CARAMEL",
        categoryId,
        basePrice: "28000",
        isActive: "true",
        modifierGroupIds: [sizeGroupId],
      }),
      adminCookie,
    );
    expect(res.headers.get("x-action-redirect") ?? "").toMatch(/^\/admin\/products/);
    const logs = await ctx.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "product.price_changed"), eq(auditLogs.entityId, productId)));
    expect(logs[0]?.after).toEqual({ basePrice: 28000 });
    // Foto tetap ada karena tidak diganti/dihapus.
    const [row] = await ctx.db.select().from(products).where(eq(products.id, productId));
    expect(row.imagePath).not.toBeNull();
    expect((await get(orderPath())).body).toContain("Rp 28.000");
  });

  it("validasi server menolak harga tidak valid tanpa menyimpan", async () => {
    const res = await callAction(
      `/admin/products/${productId}/edit`,
      saveId(),
      productForm({ productId, name: "Iced Caramel Latte", categoryId, basePrice: "-5", isActive: "true" }),
      adminCookie,
    );
    expect(res.body).toContain("Harga minimal 0");
    const [row] = await ctx.db.select().from(products).where(eq(products.id, productId));
    expect(row.basePrice).toBe(28000);
  });

  it("admin menghapus produk (soft delete) → hilang dari menu customer", async () => {
    const res = await callAction(
      "/admin/products",
      actionId("src/app/admin/products/actions.ts", "deleteProductAction"),
      JSON.stringify([productId]),
      adminCookie,
    );
    expect(res.body).toContain("Produk dihapus.");
    const [row] = await ctx.db.select().from(products).where(eq(products.id, productId));
    expect(row.deletedAt).not.toBeNull();
    expect((await get(orderPath())).body).toContain("Menu belum tersedia");
  });
});
