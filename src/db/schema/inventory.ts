import {
  boolean,
  date,
  index,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, money, quantity, timestamps } from "./columns";
import { approvals } from "./control";
import {
  inventoryItemKind,
  inventoryTransactionType,
  stockOpnameStatus,
} from "./enums";
import { createdBy } from "./identity";
import { tenantColumns } from "./tenancy";

// PRD §19
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: id(),
    ...tenantColumns(),
    sku: text().notNull(),
    name: text().notNull(),
    kind: inventoryItemKind().notNull(),
    category: text(),
    /** gram, ml, pcs, botol, ... */
    unit: text().notNull(),
    /**
     * Saldo cache dari ledger inventory_transactions. Hanya boleh diubah
     * dalam transaksi DB yang sama dengan insert ledger.
     */
    stockQty: quantity().notNull().default("0"),
    minimumStock: quantity().notNull().default("0"),
    purchasePrice: money(),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [unique().on(t.outletId, t.sku)],
).enableRLS();

/** PRD §106 — ledger stok, append-only. */
export const inventoryTransactions = pgTable(
  "inventory_transactions",
  {
    id: id(),
    ...tenantColumns(),
    itemId: uuid()
      .notNull()
      .references(() => inventoryItems.id),
    type: inventoryTransactionType().notNull(),
    /** Positif = stok masuk, negatif = stok keluar. */
    quantity: quantity().notNull(),
    balanceAfter: quantity().notNull(),
    unitCost: money(),
    batchCode: text(),
    expiryDate: date(),
    reason: text(),
    photoPath: text(),
    /** Sumber perubahan, mis. order / stock_opname. */
    referenceType: text(),
    referenceId: uuid(),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.itemId, t.createdAt),
    index().on(t.referenceType, t.referenceId),
  ],
).enableRLS();

// PRD §23
export const stockOpnames = pgTable("stock_opnames", {
  id: id(),
  ...tenantColumns(),
  status: stockOpnameStatus().notNull().default("draft"),
  notes: text(),
  approvalId: uuid().references(() => approvals.id),
  createdBy: createdBy(),
  ...timestamps(),
}).enableRLS();

export const stockOpnameItems = pgTable(
  "stock_opname_items",
  {
    id: id(),
    opnameId: uuid()
      .notNull()
      .references(() => stockOpnames.id, { onDelete: "cascade" }),
    itemId: uuid()
      .notNull()
      .references(() => inventoryItems.id),
    systemQty: quantity().notNull(),
    actualQty: quantity().notNull(),
    variance: quantity().notNull(),
    /** Wajib diisi jika variance ≠ 0 (divalidasi di aplikasi). */
    reason: text(),
  },
  (t) => [unique().on(t.opnameId, t.itemId)],
).enableRLS();
