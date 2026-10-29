import { sql } from "drizzle-orm";
import {
  date,
  doublePrecision,
  index,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "./columns";
import { approvals } from "./control";
import { attendanceStatus } from "./enums";
import { createdBy, employees } from "./identity";
import { tenantColumns } from "./tenancy";

/**
 * PRD §11 & §82 — wajah disimpan di provider face recognition (template
 * terenkripsi di sana). Kita hanya menyimpan referensinya dan bukti consent.
 */
export const faceEnrollments = pgTable("face_enrollments", {
  id: id(),
  employeeId: uuid()
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  provider: text().notNull(),
  externalFaceId: text().notNull(),
  consentAt: timestamp({ withTimezone: true }).notNull(),
  revokedAt: timestamp({ withTimezone: true }),
  ...timestamps(),
}).enableRLS();

// PRD §15
export const outsideDutyRequests = pgTable("outside_duty_requests", {
  id: id(),
  ...tenantColumns(),
  employeeId: uuid()
    .notNull()
    .references(() => employees.id),
  dutyDate: date().notNull(),
  location: text().notNull(),
  latitude: doublePrecision(),
  longitude: doublePrecision(),
  purpose: text().notNull(),
  notes: text(),
  evidencePath: text(),
  approvalId: uuid().references(() => approvals.id),
  createdBy: createdBy(),
  ...timestamps(),
}).enableRLS();

/** Satu baris = satu pasang check-in/check-out (PRD §9, §10, §14). */
export const attendances = pgTable(
  "attendances",
  {
    id: id(),
    ...tenantColumns(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    /** Tanggal bisnis di zona waktu outlet. */
    businessDate: date().notNull(),
    status: attendanceStatus().notNull().default("checked_in"),
    /** Jika ada, geofence outlet tidak diberlakukan (PRD §15). */
    outsideDutyRequestId: uuid().references(() => outsideDutyRequests.id),

    checkInAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    checkInLatitude: doublePrecision().notNull(),
    checkInLongitude: doublePrecision().notNull(),
    checkInAccuracyMeter: real(),
    checkInDistanceMeter: real(),
    checkInFaceScore: real(),
    checkInPhotoPath: text(),
    checkInDevice: text(),
    checkInIp: text(),

    checkOutAt: timestamp({ withTimezone: true }),
    checkOutLatitude: doublePrecision(),
    checkOutLongitude: doublePrecision(),
    checkOutAccuracyMeter: real(),
    checkOutDistanceMeter: real(),
    checkOutFaceScore: real(),
    checkOutPhotoPath: text(),
    checkOutDevice: text(),
    checkOutIp: text(),

    ...timestamps(),
  },
  (t) => [
    index().on(t.outletId, t.businessDate),
    // Hanya boleh ada satu sesi yang belum check-out per karyawan.
    uniqueIndex("attendances_one_open_per_employee")
      .on(t.employeeId)
      .where(sql`${t.checkOutAt} is null`),
  ],
).enableRLS();
