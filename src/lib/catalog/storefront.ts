// Katalog customer per outlet. Tanpa dependency Next.js (dipakai juga oleh
// test & quote harga). Hanya data yang aman untuk publik yang dikembalikan.

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/client";
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

import { menuImageUrl } from "./image-url";
import type { PricingGroup, PricingProduct } from "./pricing";

export type StorefrontProduct = PricingProduct & {
  slug: string;
  description: string | null;
  imageUrl: string | null;
  categoryId: string;
  defaultModifierIds: string[];
};

export type Storefront = {
  outlet: { id: string; code: string; name: string };
  brand: { id: string; name: string };
  categories: { id: string; name: string; slug: string }[];
  products: StorefrontProduct[];
};

const OUTLET_CODE = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Ketersediaan (PRD §21, §73) — tiga hal terpisah:
 * - manual sold out  : outlet_products.is_available = false (diatur admin,
 *   tidak pernah ditimpa sinkronisasi stok);
 * - inventory unavailable : produk jadi yang terhubung ke item stok dengan
 *   saldo 0 atau item nonaktif;
 * - effective = tidak manual sold out DAN tidak inventory unavailable.
 * Minuman racikan (tanpa link item / BOM) hanya mengikuti status manual.
 */
export function availabilityOf(row: {
  manualAvailable: boolean;
  linkedItemId: string | null;
  linkedStock: string | null;
  linkedActive: boolean | null;
}) {
  const manualSoldOut = !row.manualAvailable;
  const inventoryUnavailable =
    row.linkedItemId !== null && (!row.linkedActive || Number(row.linkedStock ?? 0) <= 0);
  return { manualSoldOut, inventoryUnavailable, effective: !manualSoldOut && !inventoryUnavailable };
}

export async function loadStorefront(
  db: DbExecutor,
  outletCode: string,
  options: { withStock?: boolean } = {},
): Promise<Storefront | null> {
  if (!OUTLET_CODE.test(outletCode)) return null;

  const [outlet] = await db
    .select({
      id: outlets.id,
      code: outlets.code,
      name: outlets.name,
      brandId: brands.id,
      brandName: brands.name,
    })
    .from(outlets)
    .innerJoin(brands, eq(brands.id, outlets.brandId))
    .where(and(eq(outlets.code, outletCode.toUpperCase()), eq(outlets.isActive, true)))
    .limit(1);
  if (!outlet) return null;

  const categoryRows = await db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories)
    .where(
      and(
        eq(categories.brandId, outlet.brandId),
        eq(categories.isActive, true),
        isNull(categories.deletedAt),
      ),
    )
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  const productRows = categoryRows.length
    ? await db
        .select({
          id: products.id,
          name: products.name,
          slug: products.slug,
          description: products.description,
          imagePath: products.imagePath,
          categoryId: products.categoryId,
          price: sql<number>`coalesce(${outletProducts.priceOverride}, ${products.basePrice})`.mapWith(Number),
          manualAvailable: sql<boolean>`coalesce(${outletProducts.isAvailable}, true)`,
          linkedItemId: inventoryItems.id,
          linkedStock: inventoryItems.stockQty,
          linkedActive: inventoryItems.isActive,
        })
        .from(products)
        .leftJoin(
          outletProducts,
          and(eq(outletProducts.productId, products.id), eq(outletProducts.outletId, outlet.id)),
        )
        .leftJoin(
          inventoryItems,
          and(
            eq(inventoryItems.id, outletProducts.inventoryItemId),
            eq(inventoryItems.outletId, outlet.id),
          ),
        )
        .where(
          and(
            eq(products.brandId, outlet.brandId),
            eq(products.isActive, true),
            isNull(products.deletedAt),
            inArray(products.categoryId, categoryRows.map((c) => c.id)),
          ),
        )
        .orderBy(asc(products.sortOrder), asc(products.name))
    : [];

  const productIds = productRows.map((p) => p.id);
  const groupLinks = productIds.length
    ? await db
        .select({
          productId: productModifierGroups.productId,
          id: modifierGroups.id,
          name: modifierGroups.name,
          selection: modifierGroups.selection,
          isRequired: modifierGroups.isRequired,
          minSelect: modifierGroups.minSelect,
          maxSelect: modifierGroups.maxSelect,
        })
        .from(productModifierGroups)
        .innerJoin(modifierGroups, eq(modifierGroups.id, productModifierGroups.groupId))
        .where(
          and(
            inArray(productModifierGroups.productId, productIds),
            eq(modifierGroups.brandId, outlet.brandId),
          ),
        )
        .orderBy(asc(productModifierGroups.sortOrder), asc(modifierGroups.sortOrder))
    : [];

  const groupIds = [...new Set(groupLinks.map((g) => g.id))];
  const optionRows = groupIds.length
    ? await db
        .select({
          id: modifiers.id,
          groupId: modifiers.groupId,
          name: modifiers.name,
          priceDelta: modifiers.priceDelta,
          isDefault: modifiers.isDefault,
        })
        .from(modifiers)
        .where(and(inArray(modifiers.groupId, groupIds), eq(modifiers.isActive, true)))
        .orderBy(asc(modifiers.sortOrder), asc(modifiers.createdAt))
    : [];

  return {
    outlet: { id: outlet.id, code: outlet.code, name: outlet.name },
    brand: { id: outlet.brandId, name: outlet.brandName },
    categories: categoryRows,
    products: productRows.map((p) => {
      const groups: PricingGroup[] = groupLinks
        .filter((g) => g.productId === p.id)
        .map((g) => ({
          id: g.id,
          name: g.name,
          selection: g.selection,
          isRequired: g.isRequired,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          modifiers: optionRows
            .filter((o) => o.groupId === g.id)
            .map(({ id, name, priceDelta }) => ({ id, name, priceDelta })),
        }))
        // Grup tanpa opsi aktif tidak bisa dipilih — jangan blokir pesanan.
        .filter((g) => g.modifiers.length > 0);
      const groupIdSet = new Set(groups.map((g) => g.id));
      const availability = availabilityOf(p);
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        imageUrl: menuImageUrl(p.imagePath),
        categoryId: p.categoryId,
        price: p.price,
        isAvailable: availability.effective,
        ...(options.withStock
          ? {
              stockLimit:
                p.linkedItemId === null ? null : Math.max(0, Math.floor(Number(p.linkedStock ?? 0))),
            }
          : {}),
        groups,
        defaultModifierIds: optionRows
          .filter((o) => o.isDefault && groupIdSet.has(o.groupId))
          .map((o) => o.id),
      };
    }),
  };
}

/** Kode outlet default bila QR tidak menyertakan ?outlet= (hanya jika outlet aktif tunggal). */
export async function loadDefaultOutletCode(db: DbExecutor) {
  const rows = await db
    .select({ code: outlets.code })
    .from(outlets)
    .where(eq(outlets.isActive, true))
    .limit(2);
  return rows.length === 1 ? rows[0].code : null;
}
