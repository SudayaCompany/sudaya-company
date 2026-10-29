import { createClient } from "@supabase/supabase-js";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLogs, outletProducts, productModifierGroups, products } from "@/db/schema";
import { AccessError } from "@/lib/auth/errors";
import {
  createCategory,
  createModifierGroup,
  createProduct,
  deleteCategory,
  deleteModifierGroup,
  deleteProduct,
  listModifierGroups,
  listProducts,
  productListParams,
  setProductActive,
  setProductAvailability,
  updateCategory,
  updateModifierGroup,
  updateProduct,
} from "@/lib/catalog/admin-ops";
import { menuImageUrl } from "@/lib/catalog/image-url";
import type { MenuImageStorage } from "@/lib/catalog/images";
import { quoteCart } from "@/lib/catalog/quote";
import { loadStorefront } from "@/lib/catalog/storefront";
import { menuImageStorage } from "@/lib/supabase/storage";

import {
  TINY_PNG,
  createLiveContext,
  hasLiveEnv,
  type LiveContext,
  type TestCompany,
  type TestUser,
} from "../helpers/live";

const audit = { ip: "127.0.0.1", userAgent: "vitest" };

async function expectAccessError(promise: Promise<unknown>, code: AccessError["code"]) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
}

/** Storage palsu: mencatat upload/hapus tanpa menyentuh Supabase. */
function fakeStorage() {
  const uploaded: string[] = [];
  const removed: string[] = [];
  const storage: MenuImageStorage = {
    async upload(path) {
      uploaded.push(path);
    },
    async remove(paths) {
      removed.push(...paths);
    },
  };
  return { storage, uploaded, removed };
}

const png = { bytes: TINY_PNG, ext: "png", contentType: "image/png" };

describe.skipIf(!hasLiveEnv)("katalog: admin ops, storefront & storage (DB live)", () => {
  let ctx: LiveContext;
  let A: TestCompany;
  let B: TestCompany;
  let superA: TestUser;
  let adminA: TestUser;
  let managerA: TestUser;
  let baristaA: TestUser;
  let superB: TestUser;
  let coffeeId: string;
  let sizeGroupId: string;
  let toppingGroupId: string;

  const productValues = (overrides: Record<string, unknown> = {}) => ({
    name: "Iced Latte",
    categoryId: coffeeId,
    basePrice: "25000",
    isActive: true,
    modifierGroupIds: [sizeGroupId, toppingGroupId],
    ...overrides,
  });

  beforeAll(async () => {
    ctx = createLiveContext();
    A = await ctx.createCompany("cata");
    B = await ctx.createCompany("catb");
    superA = await ctx.createUser(A, [{ role: "super_admin" }]);
    adminA = await ctx.createUser(A, [{ role: "admin" }]);
    managerA = await ctx.createUser(A, [{ role: "manager", outlet: "outlet" }]);
    baristaA = await ctx.createUser(A, [{ role: "barista", outlet: "outlet" }]);
    superB = await ctx.createUser(B, [{ role: "super_admin" }]);

    coffeeId = (await createCategory(ctx.db, adminA.current, A.brandId, { name: "Coffee" }, audit))!.id;
    sizeGroupId = (
      await createModifierGroup(ctx.db, adminA.current, A.brandId, {
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
    toppingGroupId = (
      await createModifierGroup(ctx.db, adminA.current, A.brandId, {
        name: "Topping",
        selection: "multiple",
        isRequired: false,
        minSelect: 0,
        maxSelect: 2,
        options: [
          { name: "Extra Shot", priceDelta: 5000 },
          { name: "Hazelnut Syrup", priceDelta: 3000 },
        ],
      }, audit)
    ).id;
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });

  describe("CRUD produk + audit", () => {
    let productId: string;

    it("admin membuat produk dengan foto & modifier, tercatat di audit", async () => {
      const fake = fakeStorage();
      const created = await createProduct(ctx.db, adminA.current, A.brandId, productValues({ sku: "cf-latte" }), png, audit, fake.storage);
      productId = created!.id;

      const [row] = await ctx.db.select().from(products).where(eq(products.id, productId));
      expect(row).toMatchObject({ slug: "iced-latte", sku: "CF-LATTE", basePrice: 25000, companyId: A.id, brandId: A.brandId });
      expect(row.imagePath).toBe(fake.uploaded[0]);
      expect(row.imagePath!.startsWith(`${A.id}/${A.brandId}/`)).toBe(true);

      const links = await ctx.db.select().from(productModifierGroups).where(eq(productModifierGroups.productId, productId));
      expect(links.map((l) => l.groupId).sort()).toEqual([sizeGroupId, toppingGroupId].sort());
      expect(await ctx.countAudit(A.id, "product.created", productId)).toBe(1);
    });

    it("perubahan harga dicatat sebagai product.price_changed", async () => {
      const fake = fakeStorage();
      await updateProduct(ctx.db, adminA.current, productId, productValues({ sku: "CF-LATTE", basePrice: "27000", name: "Iced Latte Aren" }), { image: null, remove: false }, audit, fake.storage);

      const [priceLog] = await ctx.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "product.price_changed"), eq(auditLogs.entityId, productId)));
      expect(priceLog.before).toEqual({ basePrice: 25000 });
      expect(priceLog.after).toEqual({ basePrice: 27000 });
      expect(await ctx.countAudit(A.id, "product.updated", productId)).toBe(1);
      // Slug tidak ikut berubah saat nama diubah (hanya bila dikirim).
      const [row] = await ctx.db.select().from(products).where(eq(products.id, productId));
      expect(row.slug).toBe("iced-latte-aren");
    });

    it("ganti foto: foto baru diunggah, foto lama dihapus", async () => {
      const [before] = await ctx.db.select().from(products).where(eq(products.id, productId));
      const fake = fakeStorage();
      await updateProduct(ctx.db, adminA.current, productId, productValues({ sku: "CF-LATTE", basePrice: "27000", name: "Iced Latte Aren" }), { image: png, remove: false }, audit, fake.storage);
      const [after] = await ctx.db.select().from(products).where(eq(products.id, productId));
      expect(after.imagePath).toBe(fake.uploaded[0]);
      expect(fake.removed).toEqual([before.imagePath]);

      const removeFake = fakeStorage();
      await updateProduct(ctx.db, adminA.current, productId, productValues({ sku: "CF-LATTE", basePrice: "27000", name: "Iced Latte Aren" }), { image: null, remove: true }, audit, removeFake.storage);
      const [cleared] = await ctx.db.select().from(products).where(eq(products.id, productId));
      expect(cleared.imagePath).toBeNull();
      expect(removeFake.removed).toEqual([after.imagePath]);
      expect(await ctx.countAudit(A.id, "product.image_removed", productId)).toBe(1);
    });

    it("slug & SKU duplikat ditolak; foto yang terlanjur diunggah dihapus lagi", async () => {
      const fake = fakeStorage();
      await expectAccessError(
        createProduct(ctx.db, adminA.current, A.brandId, productValues({ name: "Iced Latte Aren" }), png, audit, fake.storage),
        "conflict",
      );
      expect(fake.removed).toEqual(fake.uploaded);
      await expectAccessError(
        createProduct(ctx.db, adminA.current, A.brandId, productValues({ name: "Hot Latte", sku: "cf-latte" }), null, audit, fakeStorage().storage),
        "conflict",
      );
    });

    it("mass assignment: company/brand/imagePath dari input diabaikan", async () => {
      const created = await createProduct(
        ctx.db,
        adminA.current,
        A.brandId,
        { ...productValues({ name: "Americano" }), companyId: B.id, brandId: B.brandId, imagePath: "evil/x.png", deletedAt: null },
        null,
        audit,
        fakeStorage().storage,
      );
      const [row] = await ctx.db.select().from(products).where(eq(products.id, created!.id));
      expect(row).toMatchObject({ companyId: A.id, brandId: A.brandId, imagePath: null, deletedAt: null });
    });

    it("pencarian, filter, sorting & pagination", async () => {
      const params = (raw: Record<string, string>) => productListParams.parse(raw);
      const byName = await listProducts(ctx.db, superA.current, A.brandId, A.outletId, params({ q: "latte" }));
      expect(byName.rows.map((r) => r.name)).toEqual(["Iced Latte Aren"]);
      const bySku = await listProducts(ctx.db, superA.current, A.brandId, A.outletId, params({ q: "cf-lat" }));
      expect(bySku.total).toBe(1);
      const sorted = await listProducts(ctx.db, superA.current, A.brandId, A.outletId, params({ sort: "price", dir: "desc" }));
      expect(sorted.rows.map((r) => r.basePrice)).toEqual([27000, 25000]);
      // Wildcard LIKE dari user di-escape.
      expect((await listProducts(ctx.db, superA.current, A.brandId, A.outletId, params({ q: "%" }))).total).toBe(0);
      const page99 = await listProducts(ctx.db, superA.current, A.brandId, A.outletId, params({ page: "99" }));
      expect(page99.page).toBe(1);
    });
  });

  describe("permission & scope", () => {
    it("barista tidak bisa melihat maupun membuat produk", async () => {
      await expectAccessError(listProducts(ctx.db, baristaA.current, A.brandId, null, productListParams.parse({})), "forbidden");
      await expectAccessError(
        createProduct(ctx.db, baristaA.current, A.brandId, productValues({ name: "Teh" }), null, audit, fakeStorage().storage),
        "forbidden",
      );
    });

    it("manager outlet: boleh lihat & sold out di outletnya, tidak boleh ubah data master", async () => {
      const list = await listProducts(ctx.db, managerA.current, A.brandId, A.outletId, productListParams.parse({}));
      const product = list.rows[0];
      await expectAccessError(
        updateProduct(ctx.db, managerA.current, product.id, productValues({ name: product.name, basePrice: "1" }), { image: null, remove: false }, audit, fakeStorage().storage),
        "forbidden",
      );
      await expectAccessError(createCategory(ctx.db, managerA.current, A.brandId, { name: "Hack" }, audit), "forbidden");

      await setProductAvailability(ctx.db, managerA.current, { productId: product.id, outletId: A.outletId, isAvailable: false }, audit);
      const [op] = await ctx.db.select().from(outletProducts).where(eq(outletProducts.productId, product.id));
      expect(op.isAvailable).toBe(false);
      expect(await ctx.countAudit(A.id, "product.availability_changed", product.id)).toBe(1);

      // Outlet company lain → ditolak.
      await expectAccessError(
        setProductAvailability(ctx.db, managerA.current, { productId: product.id, outletId: B.outletId, isAvailable: true }, audit),
        "forbidden",
      );
      await setProductAvailability(ctx.db, managerA.current, { productId: product.id, outletId: A.outletId, isAvailable: true }, audit);
    });

    it("company B tidak bisa membaca atau mengubah katalog company A", async () => {
      const list = await listProducts(ctx.db, adminA.current, A.brandId, null, productListParams.parse({}));
      const productId = list.rows[0].id;
      expect((await listProducts(ctx.db, superB.current, A.brandId, null, productListParams.parse({}))).total).toBe(0);
      await expectAccessError(setProductActive(ctx.db, superB.current, { productId, isActive: false }, audit), "not_found");
      await expectAccessError(deleteProduct(ctx.db, superB.current, productId, audit), "not_found");
      await expectAccessError(
        createProduct(ctx.db, superB.current, A.brandId, productValues({ name: "X" }), null, audit, fakeStorage().storage),
        "not_found",
      );
      // Kategori/grup milik A dipakai di brand B → ditolak.
      await expectAccessError(
        createProduct(ctx.db, superB.current, B.brandId, productValues({ name: "X" }), null, audit, fakeStorage().storage),
        "invalid",
      );
    });
  });

  describe("kategori & modifier", () => {
    it("kategori berisi produk tidak bisa dihapus; slug duplikat ditolak", async () => {
      await expectAccessError(deleteCategory(ctx.db, adminA.current, coffeeId, audit), "conflict");
      const tea = await createCategory(ctx.db, adminA.current, A.brandId, { name: "Tea" }, audit);
      await expectAccessError(updateCategory(ctx.db, adminA.current, tea!.id, { name: "Tea", slug: "coffee" }, audit), "conflict");
      await deleteCategory(ctx.db, adminA.current, tea!.id, audit);
      expect(await ctx.countAudit(A.id, "category.deleted", tea!.id)).toBe(1);
    });

    it("opsi milik grup lain ditolak; perubahan harga opsi tercatat", async () => {
      const groups = await listModifierGroups(ctx.db, adminA.current, A.brandId);
      const size = groups.find((g) => g.id === sizeGroupId)!;
      const topping = groups.find((g) => g.id === toppingGroupId)!;
      // Iced Latte Aren & Americano memakai Size + Topping.
      expect(size.productCount).toBe(2);
      expect(topping.productCount).toBe(2);
      await expectAccessError(
        updateModifierGroup(ctx.db, adminA.current, sizeGroupId, {
          name: "Size", selection: "single", isRequired: true, minSelect: 1, maxSelect: 1,
          options: [{ id: topping.options[0].id, name: "Curian", priceDelta: 0 }],
        }, audit),
        "not_found",
      );
      await updateModifierGroup(ctx.db, adminA.current, sizeGroupId, {
        name: "Size", selection: "single", isRequired: true, minSelect: 1, maxSelect: 1,
        options: size.options.map((o) => ({ ...o, priceDelta: o.name === "Large" ? 7000 : o.priceDelta })),
      }, audit);
      const [log] = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "modifier_group.updated"), eq(auditLogs.entityId, sizeGroupId)));
      expect(JSON.stringify(log.after)).toContain("Large (+7000)");
    });
  });

  describe("storefront customer & quote server", () => {
    it("hanya produk aktif, tidak terhapus; sold out ditandai; harga & modifier dari DB", async () => {
      const list = await listProducts(ctx.db, adminA.current, A.brandId, null, productListParams.parse({ sort: "name" }));
      const [americano, latte] = list.rows;
      await setProductAvailability(ctx.db, adminA.current, { productId: americano.id, outletId: A.outletId, isAvailable: false }, audit);

      let storefront = (await loadStorefront(ctx.db, A.outletCode))!;
      expect(storefront.products.map((p) => p.name).sort()).toEqual(["Americano", "Iced Latte Aren"]);
      expect(storefront.products.find((p) => p.id === americano.id)!.isAvailable).toBe(false);
      const lattePublic = storefront.products.find((p) => p.id === latte.id)!;
      expect(lattePublic.price).toBe(27000);
      expect(lattePublic.groups.map((g) => g.name)).toEqual(["Size", "Topping"]);
      // Data publik tidak membocorkan kolom internal.
      expect(lattePublic).not.toHaveProperty("companyId");
      expect(lattePublic).not.toHaveProperty("sku");

      const large = lattePublic.groups[0].modifiers.find((m) => m.name === "Large")!;
      const shot = lattePublic.groups[1].modifiers.find((m) => m.name === "Extra Shot")!;
      const quote = quoteCart(storefront, [
        { productId: latte.id, modifierIds: [large.id, shot.id], quantity: 2 },
        { productId: latte.id, modifierIds: [], quantity: 1 },
        { productId: americano.id, modifierIds: [storefront.products[0].groups[0]?.modifiers[0]?.id].filter(Boolean) as string[], quantity: 1 },
      ]);
      expect(quote).toMatchObject({ ok: true, total: (27000 + 7000 + 5000) * 2 });
      if (quote.ok) {
        expect(quote.lines[1]).toMatchObject({ ok: false, error: "Pilih Size." });
        expect(quote.lines[2]).toMatchObject({ ok: false, error: "Maaf, produk baru saja habis." });
      }

      await setProductActive(ctx.db, adminA.current, { productId: americano.id, isActive: false }, audit);
      await deleteProduct(ctx.db, adminA.current, latte.id, audit);
      storefront = (await loadStorefront(ctx.db, A.outletCode))!;
      expect(storefront.products).toHaveLength(0);
      expect(await loadStorefront(ctx.db, "TIDAKADA")).toBeNull();
      expect(await loadStorefront(ctx.db, "x' or 1=1 --")).toBeNull();
    });

    it("hapus grup modifier melepas relasi produk (histori aman)", async () => {
      await deleteModifierGroup(ctx.db, adminA.current, toppingGroupId, audit);
      const links = await ctx.db.select().from(productModifierGroups).where(eq(productModifierGroups.groupId, toppingGroupId));
      expect(links).toHaveLength(0);
    });
  });

  describe("Supabase Storage sungguhan", () => {
    it("upload via server lalu publik bisa membaca; anon tidak bisa upload/hapus", async () => {
      const path = `${A.id}/${A.brandId}/storage-test.png`;
      await menuImageStorage.upload(path, TINY_PNG, "image/png");
      const url = menuImageUrl(path)!;
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");

      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
        auth: { persistSession: false },
      });
      const upload = await anon.storage.from("menu-images").upload(`${A.id}/${A.brandId}/anon.png`, TINY_PNG, { contentType: "image/png" });
      expect(upload.error).not.toBeNull();
      const removal = await anon.storage.from("menu-images").remove([path]);
      expect(removal.data ?? []).toHaveLength(0);
      expect((await fetch(url)).status).toBe(200);

      await menuImageStorage.remove([path]);
      expect((await fetch(`${url}?after-delete`)).status).not.toBe(200);
    });

    it("bucket selain menu-images tidak ada yang publik", async () => {
      const { data } = await ctx.admin.storage.listBuckets();
      expect(data!.filter((b) => b.public).map((b) => b.id)).toEqual(["menu-images"]);
    });
  });
});
