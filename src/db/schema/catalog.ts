import {
  boolean,
  integer,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { id, money, timestamps } from "./columns";
import { modifierSelection } from "./enums";
import { inventoryItems } from "./inventory";
import { brands, companies, outlets } from "./tenancy";

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

export const categories = pgTable("categories", {
  id: id(),
  ...brandColumns(),
  name: text().notNull(),
  sortOrder: integer().notNull().default(0),
  isActive: boolean().notNull().default(true),
  ...timestamps(),
}).enableRLS();

// PRD §28, §73
export const products = pgTable("products", {
  id: id(),
  ...brandColumns(),
  categoryId: uuid()
    .notNull()
    .references(() => categories.id),
  name: text().notNull(),
  description: text(),
  imagePath: text(),
  basePrice: money().notNull(),
  isActive: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(0),
  ...timestamps(),
}).enableRLS();

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
