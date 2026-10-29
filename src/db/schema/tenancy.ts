import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "./columns";

// PRD §76 — Company → Brand → Outlet.

export const companies = pgTable("companies", {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  ...timestamps(),
}).enableRLS();

export const brands = pgTable(
  "brands",
  {
    id: id(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id),
    code: text().notNull(),
    name: text().notNull(),
    ...timestamps(),
  },
  (t) => [unique().on(t.companyId, t.code)],
).enableRLS();

/** Jam operasional per hari, mis. { mon: { open: "07:00", close: "22:00" } }. */
export type OperatingHours = Partial<
  Record<
    "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun",
    { open: string; close: string } | null
  >
>;

// PRD §74
export const outlets = pgTable("outlets", {
  id: id(),
  companyId: uuid()
    .notNull()
    .references(() => companies.id),
  brandId: uuid()
    .notNull()
    .references(() => brands.id),
  /** Dipakai di URL QR: /order?outlet=SDY01&table=T03 (PRD §110). */
  code: text().notNull().unique(),
  name: text().notNull(),
  address: text(),
  phone: text(),
  latitude: doublePrecision(),
  longitude: doublePrecision(),
  /** PRD §13 & §121 — bisa diubah Super Admin tanpa ubah kode. */
  attendanceRadiusMeter: integer().notNull().default(5),
  timezone: text().notNull().default("Asia/Jakarta"),
  /** PRD §37 — prefix nomor order, mis. SDY → SDY-001. */
  orderNumberPrefix: text().notNull().default("SDY"),
  operatingHours: jsonb().$type<OperatingHours>(),
  isActive: boolean().notNull().default(true),
  ...timestamps(),
}).enableRLS();

/** PRD §119 — kolom wajib tabel transaksi agar siap multi-brand/outlet. */
export const tenantColumns = () => ({
  companyId: uuid()
    .notNull()
    .references(() => companies.id),
  brandId: uuid()
    .notNull()
    .references(() => brands.id),
  outletId: uuid()
    .notNull()
    .references(() => outlets.id),
});
