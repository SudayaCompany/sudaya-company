import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { createdAt, id, quantity, timestamps, unitCost } from "./columns";
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
    /** Disimpan huruf besar; unik per outlet. */
    sku: text().notNull(),
    name: text().notNull(),
    kind: inventoryItemKind().notNull(),
    category: text(),
    /** Satuan dasar stok (g, ml, pcs, botol, ...) — lihat lib/inventory/units. */
    unit: text().notNull(),
    /**
     * Saldo cache dari ledger inventory_transactions. Hanya boleh diubah
     * dalam transaksi DB yang sama dengan insert ledger.
     */
    stockQty: quantity().notNull().default("0"),
    minimumStock: quantity().notNull().default("0"),
    /** Harga pokok per satuan dasar; null = belum ada data biaya. */
    purchasePrice: unitCost(),
    /** Kedaluwarsa terdekat (opsional, untuk item yang relevan). */
    expiryDate: date(),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.outletId, t.sku),
    index().on(t.outletId, t.isActive),
    // Pengaman terakhir: aplikasi juga menolak saldo negatif sebelum update.
    check("inventory_items_stock_non_negative", sql`${t.stockQty} >= 0`),
    check("inventory_items_minimum_non_negative", sql`${t.minimumStock} >= 0`),
  ],
).enableRLS();

/**
 * PRD §106 — ledger stok, append-only. UPDATE/DELETE diblokir trigger
 * database; koreksi hanya lewat movement `reversal`.
 */
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
    unitCost: unitCost(),
    batchCode: text(),
    expiryDate: date(),
    reason: text(),
    /** Path bukti di bucket privat inventory-evidence. */
    photoPath: text(),
    /** Nomor dokumen eksternal (nota/faktur supplier, surat retur). */
    documentRef: text(),
    /** Sumber perubahan, mis. order / stock_opname / inventory_adjustment. */
    referenceType: text(),
    referenceId: uuid(),
    /**
     * Kunci unik per outlet: request yang sama (double submit, retry,
     * approval ganda) tidak pernah memposting movement kedua.
     */
    idempotencyKey: text().notNull(),
    /** Movement yang dibalik oleh baris ini (hanya type `reversal`). */
    reversesId: uuid()
      .unique()
      .references((): AnyPgColumn => inventoryTransactions.id),
    /** Tanggal bisnis movement (zona waktu outlet). */
    effectiveDate: date().notNull().default(sql`current_date`),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.outletId, t.idempotencyKey),
    index().on(t.itemId, t.createdAt),
    index().on(t.outletId, t.createdAt),
    index().on(t.referenceType, t.referenceId),
    check("inventory_transactions_quantity_non_zero", sql`${t.quantity} <> 0`),
    check("inventory_transactions_balance_non_negative", sql`${t.balanceAfter} >= 0`),
  ],
).enableRLS();

/**
 * Penyesuaian manual & reversal yang menunggu approval (PRD §69: Admin →
 * Manager). Stok baru berubah saat approval disetujui (movementId terisi).
 */
export const inventoryAdjustments = pgTable(
  "inventory_adjustments",
  {
    id: id(),
    ...tenantColumns(),
    itemId: uuid()
      .notNull()
      .references(() => inventoryItems.id),
    /** Perubahan yang diajukan; positif = tambah, negatif = kurang. */
    quantity: quantity().notNull(),
    reason: text().notNull(),
    /** Diisi jika pengajuan berupa reversal movement tertentu. */
    reversesId: uuid().references(() => inventoryTransactions.id),
    approvalId: uuid().references(() => approvals.id),
    /** Movement hasil posting (null = belum/ tidak diposting). */
    movementId: uuid().references(() => inventoryTransactions.id),
    createdBy: createdBy(),
    ...timestamps(),
  },
  (t) => [
    index().on(t.outletId, t.createdAt),
    index().on(t.reversesId),
    check("inventory_adjustments_quantity_non_zero", sql`${t.quantity} <> 0`),
  ],
).enableRLS();

// PRD §23
export const stockOpnames = pgTable(
  "stock_opnames",
  {
    id: id(),
    ...tenantColumns(),
    status: stockOpnameStatus().notNull().default("draft"),
    notes: text(),
    approvalId: uuid().references(() => approvals.id),
    /** Waktu saldo sistem di-snapshot (system_qty). */
    snapshotAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp({ withTimezone: true }),
    /** Waktu variance diposting ke ledger (status applied). */
    postedAt: timestamp({ withTimezone: true }),
    createdBy: createdBy(),
    ...timestamps(),
  },
  (t) => [
    index().on(t.outletId, t.status),
    // Satu sesi opname terbuka per outlet: dua sesi paralel bisa memposting
    // selisih yang sama dua kali.
    uniqueIndex("stock_opnames_one_open_per_outlet")
      .on(t.outletId)
      .where(sql`${t.status} in ('draft', 'submitted')`),
  ],
).enableRLS();

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
    /** Saldo sistem saat snapshot. */
    systemQty: quantity().notNull(),
    /** null = belum dihitung. */
    actualQty: quantity(),
    /** actual − system (dihitung server). */
    variance: quantity(),
    /** Wajib diisi jika variance ≠ 0 (divalidasi di aplikasi). */
    reason: text(),
  },
  (t) => [unique().on(t.opnameId, t.itemId)],
).enableRLS();
