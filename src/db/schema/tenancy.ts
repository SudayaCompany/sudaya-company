import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
export const outlets = pgTable(
  "outlets",
  {
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
  /**
   * Order belum dibayar otomatis kedaluwarsa setelah N menit (dihitung dari
   * waktu database, dijalankan pg_cron → public.expire_pending_orders).
   */
  pendingPaymentTtlMinutes: integer().notNull().default(15),
  operatingHours: jsonb().$type<OperatingHours>(),
  isActive: boolean().notNull().default(true),
  ...timestamps(),
  },
  (t) => [
    check(
      "outlets_pending_payment_ttl_range",
      sql`${t.pendingPaymentTtlMinutes} between 1 and 1440`,
    ),
    check(
      "outlets_attendance_radius_range",
      sql`${t.attendanceRadiusMeter} between 1 and 1000`,
    ),
    check(
      "outlets_coordinates_valid",
      sql`(${t.latitude} is null and ${t.longitude} is null) or (${t.latitude} between -90 and 90 and ${t.longitude} between -180 and 180)`,
    ),
  ],
).enableRLS();

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
