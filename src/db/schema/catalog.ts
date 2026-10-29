import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, money, quantity, timestamps } from "./columns";
import { modifierSelection } from "./enums";
import { inventoryItems } from "./inventory";
import { brands, companies, outlets, tenantColumns } from "./tenancy";

// Menu dikelola per brand; harga & ketersediaan per outlet ada di
// outlet_products agar multi-outlet tidak mengubah struktur (PRD §75).

const brandColumns = () => ({
  companyId: uuid()
    .notNull()
    .references(() => companies.id),
  brandId: uuid()
    .notNull()
    .references(() => brands.id),
});

/**
 * Soft delete: produk direferensikan order_items (tanpa cascade), jadi baris
 * tidak pernah dihapus fisik. Slug/SKU unik hanya di antara baris aktif.
 */
const deletedAt = () => timestamp({ withTimezone: true });

export const categories = pgTable(
  "categories",
  {
    id: id(),
    ...brandColumns(),
    name: text().notNull(),
    slug: text().notNull(),
    sortOrder: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    deletedAt: deletedAt(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("categories_brand_slug_unique")
      .on(t.brandId, t.slug)
      .where(sql`${t.deletedAt} is null`),
  ],
).enableRLS();

// PRD §28, §73
export const products = pgTable(
  "products",
  {
    id: id(),
    ...brandColumns(),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id),
    name: text().notNull(),
    slug: text().notNull(),
    sku: text(),
    description: text(),
    /** Path objek di bucket Storage menu-images (bukan URL). */
    imagePath: text(),
    basePrice: money().notNull(),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    deletedAt: deletedAt(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("products_brand_slug_unique")
      .on(t.brandId, t.slug)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex("products_brand_sku_unique")
      .on(t.brandId, t.sku)
      .where(sql`${t.deletedAt} is null and ${t.sku} is not null`),
    index().on(t.brandId, t.categoryId),
  ],
).enableRLS();

export const outletProducts = pgTable(
  "outlet_products",
  {
    outletId: uuid()
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** null = pakai products.basePrice. */
    priceOverride: money(),
    /** Manual sold out oleh admin (PRD §73). */
    isAvailable: boolean().notNull().default(true),
    /**
     * Untuk produk jadi (bottled coffee, snack): otomatis sold out jika
     * stok item ini habis. Resep/BOM untuk minuman racikan menyusul (Phase 2).
     */
    inventoryItemId: uuid().references(() => inventoryItems.id),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.outletId, t.productId] })],
).enableRLS();

/**
 * Persiapan resep/BOM minuman racikan (Phase 2) — BELUM dipakai. Tanpa baris
 * di sini bahan baku tidak pernah dipotong otomatis saat penjualan; sold out
 * minuman racikan tetap manual (outlet_products.is_available).
 */
export const productRecipeItems = pgTable(
  "product_recipe_items",
  {
    id: id(),
    ...tenantColumns(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    itemId: uuid()
      .notNull()
      .references(() => inventoryItems.id),
    /** Jumlah per 1 porsi, dalam satuan dasar item. */
    quantity: quantity().notNull(),
    ...timestamps(),
  },
  (t) => [unique().on(t.outletId, t.productId, t.itemId)],
).enableRLS();

/**
 * PRD §29–30 — variant (Size, Temperature, Sugar, Milk) dan add-on
 * (Extra Shot, Syrup) dimodelkan sama: grup pilihan + opsi dengan
 * selisih harga.
 */
export const modifierGroups = pgTable("modifier_groups", {
  id: id(),
  ...brandColumns(),
  name: text().notNull(),
  selection: modifierSelection().notNull().default("single"),
  isRequired: boolean().notNull().default(false),
  minSelect: integer().notNull().default(0),
  maxSelect: integer(),
  sortOrder: integer().notNull().default(0),
  ...timestamps(),
}).enableRLS();

export const modifiers = pgTable("modifiers", {
  id: id(),
  groupId: uuid()
    .notNull()
    .references(() => modifierGroups.id, { onDelete: "cascade" }),
  name: text().notNull(),
  priceDelta: money().notNull().default(0),
  isDefault: boolean().notNull().default(false),
  isActive: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(0),
  ...timestamps(),
}).enableRLS();

export const productModifierGroups = pgTable(
  "product_modifier_groups",
  {
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    groupId: uuid()
      .notNull()
      .references(() => modifierGroups.id, { onDelete: "cascade" }),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.groupId] })],
).enableRLS();
