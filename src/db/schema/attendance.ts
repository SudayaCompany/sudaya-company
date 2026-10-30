import { sql } from "drizzle-orm";
import {
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, timestamps } from "./columns";
import { approvals } from "./control";
import {
  attendanceCorrectionKind,
  attendanceMethod,
  attendanceStatus,
  faceSessionPurpose,
  faceSessionStatus,
} from "./enums";
import { createdBy, employees, users } from "./identity";
import { companies, tenantColumns } from "./tenancy";

/**
 * Persetujuan pemrosesan data biometrik (UU PDP No. 27/2022). Dicatat per
 * versi pemberitahuan privasi; penarikan persetujuan tidak menghapus
 * catatan ini (bukti kepatuhan), tetapi mencabut enrollment.
 */
export const biometricConsents = pgTable(
  "biometric_consents",
  {
    id: id(),
    ...tenantColumns(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    noticeVersion: text().notNull(),
    /** Dasar pemrosesan yang didokumentasikan, mis. explicit_consent. */
    basis: text().notNull(),
    givenAt: createdAt(),
    withdrawnAt: timestamp({ withTimezone: true }),
    ip: text(),
    userAgent: text(),
  },
  (t) => [index().on(t.employeeId)],
).enableRLS();

/**
 * PRD §11 & §82 — wajah disimpan di provider face recognition (template
 * terenkripsi di sana). Kita hanya menyimpan referensinya dan bukti consent.
 */
export const faceEnrollments = pgTable(
  "face_enrollments",
  {
    id: id(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    externalFaceId: text().notNull(),
    consentAt: timestamp({ withTimezone: true }).notNull(),
    consentId: uuid().references(() => biometricConsents.id),
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: uuid().references(() => users.id),
    revokedReason: text(),
    /** Penghapusan template di provider terkonfirmasi; null = perlu dicoba ulang. */
    providerDeletedAt: timestamp({ withTimezone: true }),
    createdBy: createdBy(),
    ...timestamps(),
  },
  (t) => [
    // Satu enrollment aktif per karyawan.
    uniqueIndex("face_enrollments_one_active_per_employee")
      .on(t.employeeId)
      .where(sql`${t.revokedAt} is null`),
  ],
).enableRLS();

/**
 * Sesi liveness/verifikasi yang diterbitkan server ke satu karyawan. Hanya
 * bisa dipakai sekali (status issued → consumed) sehingga hasil verifikasi
 * tidak bisa diputar ulang untuk karyawan atau absensi lain.
 */
export const faceVerificationSessions = pgTable(
  "face_verification_sessions",
  {
    id: id(),
    ...tenantColumns(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    purpose: faceSessionPurpose().notNull(),
    provider: text().notNull(),
    providerSessionId: text().notNull(),
    status: faceSessionStatus().notNull().default("issued"),
    /** Skor dari provider (skala provider); tanpa gambar/template. */
    livenessScore: real(),
    matchScore: real(),
    failureReason: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.provider, t.providerSessionId),
    index().on(t.employeeId, t.createdAt),
  ],
).enableRLS();

// PRD §15
export const outsideDutyRequests = pgTable(
  "outside_duty_requests",
  {
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
    /** Alasan / keterangan. */
    notes: text(),
    evidencePath: text(),
    /** Jendela tugas (waktu outlet → timestamptz). Geofence outlet tidak berlaku di dalamnya. */
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    approvalId: uuid().references(() => approvals.id),
    createdBy: createdBy(),
    ...timestamps(),
  },
  (t) => [
    index().on(t.employeeId, t.dutyDate),
    check("outside_duty_window_valid", sql`${t.endsAt} is null or ${t.startsAt} is null or ${t.endsAt} > ${t.startsAt}`),
  ],
).enableRLS();

/** Satu baris = satu pasang check-in/check-out (PRD §9, §10, §14). */
export const attendances = pgTable(
  "attendances",
  {
    id: id(),
    ...tenantColumns(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    /** Tanggal bisnis di zona waktu outlet (saat check-in). */
    businessDate: date().notNull(),
    status: attendanceStatus().notNull().default("checked_in"),
    /** Jika ada, geofence outlet tidak diberlakukan (PRD §15). */
    outsideDutyRequestId: uuid().references(() => outsideDutyRequests.id),
    /** Versi kebijakan absensi saat dicatat. */
    policyVersion: text(),

    checkInAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    checkInMethod: attendanceMethod().notNull(),
    /** null untuk koreksi manual (tidak ada data GPS). */
    checkInLatitude: doublePrecision(),
    checkInLongitude: doublePrecision(),
    checkInAccuracyMeter: real(),
    checkInDistanceMeter: real(),
    /** Skor kecocokan wajah dari provider. */
    checkInFaceScore: real(),
    checkInLivenessScore: real(),
    checkInVerificationId: uuid().references(() => faceVerificationSessions.id),
    checkInPhotoPath: text(),
    checkInDevice: text(),
    checkInIp: text(),

    checkOutAt: timestamp({ withTimezone: true }),
    checkOutMethod: attendanceMethod(),
    checkOutLatitude: doublePrecision(),
    checkOutLongitude: doublePrecision(),
    checkOutAccuracyMeter: real(),
    checkOutDistanceMeter: real(),
    checkOutFaceScore: real(),
    checkOutLivenessScore: real(),
    checkOutVerificationId: uuid().references(() => faceVerificationSessions.id),
    checkOutPhotoPath: text(),
    checkOutDevice: text(),
    checkOutIp: text(),

    /** checkout − checkin (timestamp DB), dihitung saat check-out. */
    workingMinutes: integer(),

    ...timestamps(),
  },
  (t) => [
    index().on(t.outletId, t.businessDate),
    index().on(t.employeeId, t.businessDate),
    // Hanya boleh ada satu sesi yang belum check-out per karyawan.
    uniqueIndex("attendances_one_open_per_employee")
      .on(t.employeeId)
      .where(sql`${t.checkOutAt} is null`),
    check("attendances_checkout_after_checkin", sql`${t.checkOutAt} is null or ${t.checkOutAt} >= ${t.checkInAt}`),
    check("attendances_working_minutes_non_negative", sql`${t.workingMinutes} is null or ${t.workingMinutes} >= 0`),
  ],
).enableRLS();

/**
 * Koreksi absensi manual (provider gagal / belum tersedia, GPS tidak akurat,
 * lupa check-out). Baru menjadi absensi setelah disetujui, dengan metode
 * manual_correction — tidak pernah menyamar sebagai absensi biometrik.
 */
export const attendanceCorrections = pgTable(
  "attendance_corrections",
  {
    id: id(),
    ...tenantColumns(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    kind: attendanceCorrectionKind().notNull(),
    businessDate: date().notNull(),
    /** Untuk missing_check_out: sesi yang dikoreksi. Setelah disetujui: sesi hasil. */
    attendanceId: uuid().references(() => attendances.id),
    requestedCheckInAt: timestamp({ withTimezone: true }),
    requestedCheckOutAt: timestamp({ withTimezone: true }).notNull(),
    reason: text().notNull(),
    approvalId: uuid().references(() => approvals.id),
    createdBy: createdBy(),
    ...timestamps(),
  },
  (t) => [
    index().on(t.employeeId, t.businessDate),
    check(
      "attendance_corrections_times_valid",
      sql`${t.requestedCheckInAt} is null or ${t.requestedCheckOutAt} > ${t.requestedCheckInAt}`,
    ),
  ],
).enableRLS();

/**
 * Parameter absensi per company. Radius geofence ada di outlets
 * (attendance_radius_meter, default 5). Ambang wajah null = belum
 * ditetapkan → verifikasi biometrik tidak dapat dipakai.
 */
export const attendanceSettings = pgTable(
  "attendance_settings",
  {
    companyId: uuid()
      .primaryKey()
      .references(() => companies.id),
    /** Akurasi GPS terburuk (meter) yang masih diterima. */
    maxGpsAccuracyMeter: integer().notNull().default(20),
    faceMatchThreshold: real(),
    livenessThreshold: real(),
    /** Provider yang disetujui (DPIA/review). null = belum ditetapkan. */
    verificationProvider: text(),
    policyVersion: text().notNull().default("2026-10-30"),
    updatedBy: uuid().references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    check("attendance_settings_accuracy_range", sql`${t.maxGpsAccuracyMeter} between 1 and 1000`),
    check(
      "attendance_settings_thresholds_non_negative",
      sql`(${t.faceMatchThreshold} is null or ${t.faceMatchThreshold} >= 0) and (${t.livenessThreshold} is null or ${t.livenessThreshold} >= 0)`,
    ),
  ],
).enableRLS();
