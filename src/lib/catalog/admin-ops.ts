// Operasi admin katalog (kategori, produk, modifier, ketersediaan).
// Pola sama dengan lib/auth/admin-ops: actor dari session, permission +
// scope dicek ulang di sini, input divalidasi Zod, perubahan dicatat audit.
//
// Scope: data master menu berlaku per brand, sehingga mengubahnya butuh
// permission company-wide. Sold out berlaku per outlet, jadi cukup
// permission di outlet tsb (mis. Manager outlet).

import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import type { Database, DbExecutor } from "@/db/client";
import {
  brands,
  categories,
  inventoryItems,
  modifierGroups,
  modifiers,
  outletProducts,
  outlets,
  productModifierGroups,
  products,
} from "@/db/schema";
import { recordAudit, type AuditContext } from "@/lib/audit";
import { listAccessibleOutlets, type CurrentUser } from "@/lib/auth/access";
import { AccessError } from "@/lib/auth/errors";
import { hasPermission } from "@/lib/auth/policy";
import type { Permission } from "@/lib/auth/rbac";

import { menuImagePath, type MenuImage, type MenuImageStorage } from "./images";
import {
  categoryInput,
  modifierGroupInput,
  productInput,
  type ProductInput,
} from "./schemas";

const forbidden = () =>
  new AccessError("forbidden", "Anda tidak memiliki izin untuk tindakan ini.");
const notFound = () => new AccessError("not_found", "Data tidak ditemukan.");

/** Data master menu: wajib company-wide. */
function assertMaster(actor: CurrentUser, permission: Permission) {
  if (!actor.isActive || !hasPermission(actor, permission, { outletId: null })) {
    throw forbidden();
  }
}

function assertView(actor: CurrentUser) {
  if (!actor.isActive || !hasPermission(actor, "product.view")) throw forbidden();
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AccessError("invalid", result.error.issues[0]?.message ?? "Input tidak valid.");
  }
  return result.data;
}

const parseId = (value: unknown) => parse(z.uuid({ error: "ID tidak valid." }), value);

const UNIQUE_MESSAGES: Record<string, string> = {
  products_brand_slug_unique: "Slug produk sudah dipakai produk lain.",
  products_brand_sku_unique: "SKU sudah dipakai produk lain.",
  categories_brand_slug_unique: "Slug kategori sudah dipakai kategori lain.",
};

/** Ubah pelanggaran unique index Postgres menjadi pesan yang jelas. */
function mapUniqueViolation(error: unknown): never {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    const e = current as { code?: string; constraint_name?: string; cause?: unknown };
    if (e.code === "23505") {
      throw new AccessError(
        "conflict",
        UNIQUE_MESSAGES[e.constraint_name ?? ""] ?? "Data sudah ada.",
      );
    }
    current = e.cause;
  }
  throw error;
}

function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
    }
  }
  return { before: changedBefore, after: changedAfter, changed: Object.keys(changedAfter) };
}

// --- Brand & outlet ------------------------------------------------------------

export type CatalogScope = {
  brand: { id: string; name: string };
  brands: { id: string; name: string }[];
  /** Outlet brand ini yang bisa diakses actor (untuk status sold out). */
  outlets: { id: string; code: string; name: string }[];
};

/** Brand aktif untuk halaman admin (default: brand pertama company). */
export async function resolveCatalogScope(
  db: DbExecutor,
  actor: CurrentUser,
  brandId?: string | null,
): Promise<CatalogScope> {
  assertView(actor);
  const rows = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(eq(brands.companyId, actor.company.id))
    .orderBy(asc(brands.code));
  const brand = brandId ? rows.find((b) => b.id === brandId) : rows[0];
  if (!brand) throw notFound();

  const accessible = await listAccessibleOutlets(db, actor);
  return {
    brand,
    brands: rows,
    outlets: accessible
      .filter((o) => o.brandId === brand.id)
      .map(({ id, code, name }) => ({ id, code, name })),
  };
}

async function loadBrand(db: DbExecutor, actor: CurrentUser, brandId: string) {
  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.companyId, actor.company.id)))
    .limit(1);
  if (!brand) throw notFound();
  return brand;
}

// --- Kategori --------------------------------------------------------------------

export async function listCategories(db: DbExecutor, actor: CurrentUser, brandId: string) {
  assertView(actor);
  return db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      sortOrder: categories.sortOrder,
      isActive: categories.isActive,
      productCount: sql<number>`count(${products.id})::int`,
    })
    .from(categories)
    .leftJoin(
      products,
      and(eq(products.categoryId, categories.id), isNull(products.deletedAt)),
    )
    .where(
      and(
        eq(categories.brandId, brandId),
        eq(categories.companyId, actor.company.id),
        isNull(categories.deletedAt),
      ),
    )
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

async function loadCategory(db: DbExecutor, actor: CurrentUser, categoryId: string) {
  const [row] = await db
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.id, categoryId),
        eq(categories.companyId, actor.company.id),
        isNull(categories.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw notFound();
  return row;
}

export async function createCategory(
  db: Database,
  actor: CurrentUser,
  brandId: string,
  raw: unknown,
  context: AuditContext,
) {
  assertMaster(actor, "product.create");
  await loadBrand(db, actor, brandId);
  const input = parse(categoryInput, raw);

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(categories)
        .values({ ...input, companyId: actor.company.id, brandId })
        .returning({ id: categories.id });
      await recordAudit(
        tx,
        {
          companyId: actor.company.id,
          brandId,
          actorId: actor.id,
          action: "category.created",
          entityType: "category",
          entityId: row.id,
          after: input,
        },
        context,
      );
      return { id: row.id, brandId };
    });
  } catch (error) {
    mapUniqueViolation(error);
  }
}

export async function updateCategory(
  db: Database,
  actor: CurrentUser,
  categoryId: string,
  raw: unknown,
  context: AuditContext,
) {
  assertMaster(actor, "product.edit");
  const current = await loadCategory(db, actor, parseId(categoryId));
  const input = parse(categoryInput, raw);
  const changes = diff(current, input);
  if (changes.changed.length === 0) return { id: current.id, brandId: current.brandId };

  try {
    await db.transaction(async (tx) => {
      await tx.update(categories).set(input).where(eq(categories.id, current.id));
      await recordAudit(
        tx,
        {
          companyId: actor.company.id,
          brandId: current.brandId,
          actorId: actor.id,
          action: "category.updated",
          entityType: "category",
          entityId: current.id,
          before: changes.before,
          after: changes.after,
        },
        context,
      );
    });
  } catch (error) {
    mapUniqueViolation(error);
  }
  return { id: current.id, brandId: current.brandId };
}

export async function deleteCategory(
  db: Database,
  actor: CurrentUser,
  categoryId: string,
  context: AuditContext,
) {
  assertMaster(actor, "product.delete");
  const current = await loadCategory(db, actor, parseId(categoryId));

  return db.transaction(async (tx) => {
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(products)
      .where(and(eq(products.categoryId, current.id), isNull(products.deletedAt)));
    if (total > 0) {
      throw new AccessError(
        "conflict",
        `Kategori masih berisi ${total} produk. Pindahkan atau hapus produknya dulu.`,
      );
    }
    await tx
      .update(categories)
      .set({ deletedAt: sql`now()`, isActive: false })
      .where(eq(categories.id, current.id));
    await recordAudit(
      tx,
      {
        companyId: actor.company.id,
        brandId: current.brandId,
        actorId: actor.id,
        action: "category.deleted",
        entityType: "category",
        entityId: current.id,
        before: { name: current.name, slug: current.slug },
      },
      context,
    );
    return { id: current.id, brandId: current.brandId };
  });
}

// --- Modifier --------------------------------------------------------------------

export async function listModifierGroups(
  db: DbExecutor,
  actor: CurrentUser,
  brandId: string,
) {
  assertView(actor);
  const groups = await db
    .select({
      id: modifierGroups.id,
      name: modifierGroups.name,
      selection: modifierGroups.selection,
      isRequired: modifierGroups.isRequired,
      minSelect: modifierGroups.minSelect,
      maxSelect: modifierGroups.maxSelect,
      sortOrder: modifierGroups.sortOrder,
    })
    .from(modifierGroups)
    .where(
      and(
        eq(modifierGroups.brandId, brandId),
        eq(modifierGroups.companyId, actor.company.id),
      ),
    )
    .orderBy(asc(modifierGroups.sortOrder), asc(modifierGroups.name));

  const options = groups.length
    ? await db
        .select({
          id: modifiers.id,
          groupId: modifiers.groupId,
          name: modifiers.name,
          priceDelta: modifiers.priceDelta,
          isDefault: modifiers.isDefault,
          isActive: modifiers.isActive,
        })
        .from(modifiers)
        .where(inArray(modifiers.groupId, groups.map((g) => g.id)))
        .orderBy(asc(modifiers.sortOrder), asc(modifiers.createdAt))
    : [];

  // Query agregat terpisah (subquery berkorelasi di select Drizzle merender
  // kolom tanpa nama tabel sehingga salah resolusi).
  const usage = groups.length
    ? await db
        .select({
          groupId: productModifierGroups.groupId,
          total: sql<number>`count(*)::int`,
        })
        .from(productModifierGroups)
        .innerJoin(products, eq(products.id, productModifierGroups.productId))
        .where(
          and(
            inArray(productModifierGroups.groupId, groups.map((g) => g.id)),
            isNull(products.deletedAt),
          ),
        )
        .groupBy(productModifierGroups.groupId)
    : [];

  return groups.map((group) => ({
    ...group,
    productCount: usage.find((u) => u.groupId === group.id)?.total ?? 0,
    options: options.filter((o) => o.groupId === group.id),
  }));
}

async function loadModifierGroup(db: DbExecutor, actor: CurrentUser, groupId: string) {
  const [row] = await db
    .select()
    .from(modifierGroups)
    .where(
      and(
        eq(modifierGroups.id, groupId),
        eq(modifierGroups.companyId, actor.company.id),
      ),
    )
    .limit(1);
  if (!row) throw notFound();
  return row;
}

const optionSummary = (opts: { name: string; priceDelta: number; isActive: boolean }[]) =>
  opts.map((o) => `${o.name} (${o.priceDelta >= 0 ? "+" : ""}${o.priceDelta})${o.isActive ? "" : " [nonaktif]"}`);

export async function createModifierGroup(
  db: Database,
  actor: CurrentUser,
  brandId: string,
  raw: unknown,
  context: AuditContext,
) {
  assertMaster(actor, "product.create");
  await loadBrand(db, actor, brandId);
  const { options, ...group } = parse(modifierGroupInput, raw);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(modifierGroups)
      .values({ ...group, companyId: actor.company.id, brandId })
      .returning({ id: modifierGroups.id });
    await tx.insert(modifiers).values(
      options.map((option, index) => ({
        groupId: row.id,
        name: option.name,
        priceDelta: option.priceDelta,
        isDefault: option.isDefault,
        isActive: option.isActive,
        sortOrder: index,
      })),
    );
    await recordAudit(
      tx,
      {
        companyId: actor.company.id,
        brandId,
        actorId: actor.id,
        action: "modifier_group.created",
        entityType: "modifier_group",
        entityId: row.id,
        after: { ...group, options: optionSummary(options) },
      },
      context,
    );
    return { id: row.id, brandId };
  });
}

export async function updateModifierGroup(
  db: Database,
  actor: CurrentUser,
  groupId: string,
  raw: unknown,
  context: AuditContext,
) {
  assertMaster(actor, "product.edit");
  const current = await loadModifierGroup(db, actor, parseId(groupId));
  const { options, ...group } = parse(modifierGroupInput, raw);

  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(modifiers)
      .where(eq(modifiers.groupId, current.id))
      .orderBy(asc(modifiers.sortOrder));
    const existingIds = new Set(existing.map((m) => m.id));
    for (const option of options) {
      // Id opsi milik grup lain → manipulasi request.
      if (option.id && !existingIds.has(option.id)) throw notFound();
    }

    await tx.update(modifierGroups).set(group).where(eq(modifierGroups.id, current.id));

    const keep = new Set(options.flatMap((o) => (o.id ? [o.id] : [])));
    const removed = existing.filter((m) => !keep.has(m.id));
    if (removed.length) {
      // Aman: order_item_modifiers menyimpan snapshot nama & harga.
      await tx.delete(modifiers).where(inArray(modifiers.id, removed.map((m) => m.id)));
    }
    for (const [index, option] of options.entries()) {
      const values = {
        name: option.name,
        priceDelta: option.priceDelta,
        isDefault: option.isDefault,
        isActive: option.isActive,
        sortOrder: index,
      };
      if (option.id) {
        await tx.update(modifiers).set(values).where(eq(modifiers.id, option.id));
      } else {
        await tx.insert(modifiers).values({ ...values, groupId: current.id });
      }
    }

    await recordAudit(
      tx,
      {
        companyId: actor.company.id,
        brandId: current.brandId,
        actorId: actor.id,
        action: "modifier_group.updated",
        entityType: "modifier_group",
        entityId: current.id,
        before: {
          name: current.name,
          selection: current.selection,
          isRequired: current.isRequired,
          minSelect: current.minSelect,
          maxSelect: current.maxSelect,
          options: optionSummary(existing),
        },
        after: { ...group, options: optionSummary(options) },
      },
      context,
    );
    return { id: current.id, brandId: current.brandId };
  });
}

export async function deleteModifierGroup(
  db: Database,
  actor: CurrentUser,
  groupId: string,
  context: AuditContext,
) {
  assertMaster(actor, "product.delete");
  const current = await loadModifierGroup(db, actor, parseId(groupId));

  return db.transaction(async (tx) => {
    // Cascade ke modifiers & product_modifier_groups. Histori order aman
    // karena order_item_modifiers menyimpan snapshot.
    await tx.delete(modifierGroups).where(eq(modifierGroups.id, current.id));
    await recordAudit(
      tx,
      {
        companyId: actor.company.id,
        brandId: current.brandId,
        actorId: actor.id,
        action: "modifier_group.deleted",
        entityType: "modifier_group",
        entityId: current.id,
        before: { name: current.name },
      },
      context,
    );
    return { id: current.id, brandId: current.brandId };
  });
}

// --- Produk ----------------------------------------------------------------------

export const PRODUCT_PAGE_SIZE = 20;

export const productListParams = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  category: z.uuid().optional().catch(undefined),
  status: z.enum(["all", "active", "inactive"]).catch("all"),
  availability: z.enum(["all", "available", "sold_out"]).catch("all"),
  sort: z.enum(["name", "price", "updated"]).catch("name"),
  dir: z.enum(["asc", "desc"]).catch("asc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  outlet: z.uuid().optional().catch(undefined),
});
export type ProductListParams = z.infer<typeof productListParams>;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listProducts(
  db: DbExecutor,
  actor: CurrentUser,
  brandId: string,
  outletId: string | null,
  params: ProductListParams,
) {
  assertView(actor);
  // Manual sold out (toggle admin) dan stok produk jadi dinilai terpisah;
  // filter "sold out" memakai ketersediaan efektif (lihat storefront.availabilityOf).
  const manual = sql<boolean>`coalesce(${outletProducts.isAvailable}, true)`;
  const inventoryUnavailable = sql<boolean>`(${inventoryItems.id} is not null and (not ${inventoryItems.isActive} or ${inventoryItems.stockQty} <= 0))`;
  const available = sql<boolean>`(${manual} and not ${inventoryUnavailable})`;

  const conditions: (SQL | undefined)[] = [
    eq(products.brandId, brandId),
    eq(products.companyId, actor.company.id),
    isNull(products.deletedAt),
  ];
  if (params.q) {
    const pattern = `%${escapeLike(params.q)}%`;
    conditions.push(or(ilike(products.name, pattern), ilike(products.sku, pattern)));
  }
  if (params.category) conditions.push(eq(products.categoryId, params.category));
  if (params.status !== "all") {
    conditions.push(eq(products.isActive, params.status === "active"));
  }
  if (outletId && params.availability !== "all") {
    conditions.push(sql`${available} = ${params.availability === "available"}`);
  }
  const where = and(...conditions);

  const joinOutlet = and(
    eq(outletProducts.productId, products.id),
    // Tanpa outlet terpilih, join tidak pernah cocok → dianggap tersedia.
    outletId ? eq(outletProducts.outletId, outletId) : sql`false`,
  );

  const sortColumn =
    params.sort === "price"
      ? products.basePrice
      : params.sort === "updated"
        ? products.updatedAt
        : products.name;
  const order = params.dir === "desc" ? desc(sortColumn) : asc(sortColumn);

  const joinItem = and(
    eq(inventoryItems.id, outletProducts.inventoryItemId),
    eq(inventoryItems.outletId, outletProducts.outletId),
  );

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(products)
    .leftJoin(outletProducts, joinOutlet)
    .leftJoin(inventoryItems, joinItem)
    .where(where);

  const pageCount = Math.max(1, Math.ceil(total / PRODUCT_PAGE_SIZE));
  const page = Math.min(params.page, pageCount);

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      slug: products.slug,
      imagePath: products.imagePath,
      basePrice: products.basePrice,
      isActive: products.isActive,
      updatedAt: products.updatedAt,
      categoryName: categories.name,
      /** Status manual (toggle). */
      isAvailable: manual,
      inventoryUnavailable,
      lowStock: sql<boolean>`coalesce(${inventoryItems.stockQty} > 0 and ${inventoryItems.stockQty} <= ${inventoryItems.minimumStock}, false)`,
      stockQty: inventoryItems.stockQty,
      stockUnit: inventoryItems.unit,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(outletProducts, joinOutlet)
    .leftJoin(inventoryItems, joinItem)
    .where(where)
    .orderBy(order, asc(products.id))
    .limit(PRODUCT_PAGE_SIZE)
    .offset((page - 1) * PRODUCT_PAGE_SIZE);

  return { rows, total, page, pageCount };
}

async function loadProduct(db: DbExecutor, actor: CurrentUser, productId: string) {
  const [row] = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.id, productId),
        eq(products.companyId, actor.company.id),
        isNull(products.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw notFound();
  return row;
}

export async function getProductForEdit(db: DbExecutor, actor: CurrentUser, productId: string) {
  assertMaster(actor, "product.edit");
  const product = await loadProduct(db, actor, parseId(productId));
  const groups = await db
    .select({ groupId: productModifierGroups.groupId })
    .from(productModifierGroups)
    .where(eq(productModifierGroups.productId, product.id))
    .orderBy(asc(productModifierGroups.sortOrder));
  return { ...product, modifierGroupIds: groups.map((g) => g.groupId) };
}

/** Kategori & grup modifier wajib milik brand yang sama dengan produk. */
async function assertRelations(db: DbExecutor, brandId: string, input: ProductInput) {
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.id, input.categoryId),
        eq(categories.brandId, brandId),
        isNull(categories.deletedAt),
      ),
    )
    .limit(1);
  if (!category) throw new AccessError("invalid", "Kategori tidak valid.");

  if (input.modifierGroupIds.length) {
    const groups = await db
      .select({ id: modifierGroups.id })
      .from(modifierGroups)
      .where(
        and(
          inArray(modifierGroups.id, input.modifierGroupIds),
          eq(modifierGroups.brandId, brandId),
        ),
      );
    if (groups.length !== input.modifierGroupIds.length) {
      throw new AccessError("invalid", "Grup modifier tidak valid.");
    }
  }
}

type ProductFieldSource = Pick<
  ProductInput,
  "name" | "slug" | "sku" | "description" | "categoryId" | "basePrice" | "isActive"
>;

/** Kolom produk yang boleh diubah lewat form — baris DB lama & input baru. */
function productFields(input: ProductFieldSource) {
  return {
    name: input.name,
    slug: input.slug,
    sku: input.sku,
    description: input.description,
    categoryId: input.categoryId,
    basePrice: input.basePrice,
    isActive: input.isActive,
  };
}

async function linkModifierGroups(tx: DbExecutor, productId: string, groupIds: string[]) {
  await tx.delete(productModifierGroups).where(eq(productModifierGroups.productId, productId));
  if (groupIds.length) {
    await tx.insert(productModifierGroups).values(
      groupIds.map((groupId, sortOrder) => ({ productId, groupId, sortOrder })),
    );
  }
}

export async function createProduct(
  db: Database,
  actor: CurrentUser,
  brandId: string,
  raw: unknown,
  image: MenuImage | null,
  context: AuditContext,
  storage: MenuImageStorage,
) {
  assertMaster(actor, "product.create");
  await loadBrand(db, actor, brandId);
  const input = parse(productInput, raw);
  await assertRelations(db, brandId, input);

  const imagePath = image ? menuImagePath(actor.company.id, brandId, image.ext) : null;
  if (image && imagePath) await storage.upload(imagePath, image.bytes, image.contentType);

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(products)
        .values({ ...productFields(input), imagePath, companyId: actor.company.id, brandId })
        .returning({ id: products.id });
      await linkModifierGroups(tx, row.id, input.modifierGroupIds);
      await recordAudit(
        tx,
        {
          companyId: actor.company.id,
          brandId,
          actorId: actor.id,
          action: "product.created",
          entityType: "product",
          entityId: row.id,
          after: { ...productFields(input), hasImage: Boolean(imagePath) },
        },
        context,
      );
      return { id: row.id, brandId };
    });
  } catch (error) {
    // Foto sudah terunggah tapi produk gagal disimpan → hapus lagi.
    if (imagePath) await storage.remove([imagePath]).catch(() => {});
    mapUniqueViolation(error);
  }
}

export async function updateProduct(
  db: Database,
  actor: CurrentUser,
  productId: string,
  raw: unknown,
  imageChange: { image: MenuImage | null; remove: boolean },
  context: AuditContext,
  storage: MenuImageStorage,
) {
  assertMaster(actor, "product.edit");
  const current = await loadProduct(db, actor, parseId(productId));
  const input = parse(productInput, raw);
  await assertRelations(db, current.brandId, input);

  const { image } = imageChange;
  const newPath = image ? menuImagePath(actor.company.id, current.brandId, image.ext) : null;
  const nextImagePath = newPath ?? (imageChange.remove ? null : current.imagePath);
  if (image && newPath) await storage.upload(newPath, image.bytes, image.contentType);

  try {
    await db.transaction(async (tx) => {
      const fields = productFields(input);
      const { basePrice, ...rest } = fields;
      const { basePrice: oldPrice, ...oldRest } = productFields(current);

      await tx
        .update(products)
        .set({ ...fields, imagePath: nextImagePath })
        .where(eq(products.id, current.id));

      const oldGroups = await tx
        .select({ groupId: productModifierGroups.groupId })
        .from(productModifierGroups)
        .where(eq(productModifierGroups.productId, current.id))
        .orderBy(asc(productModifierGroups.sortOrder));
      await linkModifierGroups(tx, current.id, input.modifierGroupIds);

      const base = {
        companyId: actor.company.id,
        brandId: current.brandId,
        actorId: actor.id,
        entityType: "product",
        entityId: current.id,
      };
      const changes = diff(
        { ...oldRest, modifierGroupIds: oldGroups.map((g) => g.groupId) },
        { ...rest, modifierGroupIds: input.modifierGroupIds },
      );
      if (changes.changed.length) {
        await recordAudit(
          tx,
          { ...base, action: "product.updated", before: changes.before, after: changes.after },
          context,
        );
      }
      // PRD §72: perubahan harga dicatat sebagai event tersendiri.
      if (basePrice !== oldPrice) {
        await recordAudit(
          tx,
          {
            ...base,
            action: "product.price_changed",
            before: { basePrice: oldPrice },
            after: { basePrice },
          },
          context,
        );
      }
      if (nextImagePath !== current.imagePath) {
        await recordAudit(
          tx,
          { ...base, action: newPath ? "product.image_changed" : "product.image_removed" },
          context,
        );
      }
    });
  } catch (error) {
    if (newPath) await storage.remove([newPath]).catch(() => {});
    mapUniqueViolation(error);
  }

  // Foto lama dihapus setelah DB tersimpan (best effort).
  if (current.imagePath && current.imagePath !== nextImagePath) {
    await storage.remove([current.imagePath]).catch(() => {});
  }
  return { id: current.id, brandId: current.brandId };
}

export async function setProductActive(
  db: Database,
  actor: CurrentUser,
  raw: unknown,
  context: AuditContext,
) {
  assertMaster(actor, "product.edit");
  const input = parse(z.object({ productId: z.uuid(), isActive: z.boolean() }), raw);
  const current = await loadProduct(db, actor, input.productId);
  if (current.isActive === input.isActive) return { id: current.id, brandId: current.brandId };

  return db.transaction(async (tx) => {
    await tx.update(products).set({ isActive: input.isActive }).where(eq(products.id, current.id));
    await recordAudit(
      tx,
      {
        companyId: actor.company.id,
        brandId: current.brandId,
        actorId: actor.id,
        action: "product.status_changed",
        entityType: "product",
        entityId: current.id,
        before: { isActive: current.isActive },
        after: { isActive: input.isActive },
      },
      context,
    );
    return { id: current.id, brandId: current.brandId };
  });
}

/** Soft delete — histori order tetap merujuk produk ini. */
export async function deleteProduct(
  db: Database,
  actor: CurrentUser,
  productId: string,
  context: AuditContext,
) {
  assertMaster(actor, "product.delete");
  const current = await loadProduct(db, actor, parseId(productId));

  return db.transaction(async (tx) => {
    await tx
      .update(products)
      .set({ deletedAt: sql`now()`, isActive: false })
      .where(eq(products.id, current.id));
    await recordAudit(
      tx,
      {
        companyId: actor.company.id,
        brandId: current.brandId,
        actorId: actor.id,
        action: "product.deleted",
        entityType: "product",
        entityId: current.id,
        before: { name: current.name, sku: current.sku, basePrice: current.basePrice },
      },
      context,
    );
    return { id: current.id, brandId: current.brandId };
  });
}

/** Manual sold out per outlet (PRD §73). Cukup permission di outlet tsb. */
export async function setProductAvailability(
  db: Database,
  actor: CurrentUser,
  raw: unknown,
  context: AuditContext,
) {
  const input = parse(
    z.object({ productId: z.uuid(), outletId: z.uuid(), isAvailable: z.boolean() }),
    raw,
  );
  if (!actor.isActive || !hasPermission(actor, "product.edit", { outletId: input.outletId })) {
    throw forbidden();
  }

  const product = await loadProduct(db, actor, input.productId);
  const [outlet] = await db
    .select({ id: outlets.id, brandId: outlets.brandId })
    .from(outlets)
    .where(and(eq(outlets.id, input.outletId), eq(outlets.companyId, actor.company.id)))
    .limit(1);
  if (!outlet || outlet.brandId !== product.brandId) throw notFound();

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ isAvailable: outletProducts.isAvailable })
      .from(outletProducts)
      .where(
        and(eq(outletProducts.outletId, outlet.id), eq(outletProducts.productId, product.id)),
      );
    const wasAvailable = before?.isAvailable ?? true;
    await tx
      .insert(outletProducts)
      .values({ outletId: outlet.id, productId: product.id, isAvailable: input.isAvailable })
      .onConflictDoUpdate({
        target: [outletProducts.outletId, outletProducts.productId],
        set: { isAvailable: input.isAvailable },
      });
    if (wasAvailable !== input.isAvailable) {
      await recordAudit(
        tx,
        {
          companyId: actor.company.id,
          brandId: product.brandId,
          outletId: outlet.id,
          actorId: actor.id,
          action: "product.availability_changed",
          entityType: "product",
          entityId: product.id,
          before: { isAvailable: wasAvailable },
          after: { isAvailable: input.isAvailable },
        },
        context,
      );
    }
    return { id: product.id, brandId: product.brandId };
  });
}
