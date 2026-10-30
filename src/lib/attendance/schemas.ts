// Input absensi, tugas luar, koreksi, pengaturan, dan karyawan. Browser
// tidak pernah mengirim waktu absensi resmi, jarak, atau hasil verifikasi —
// hanya koordinat mentah dan id sesi yang diterbitkan server.

import { z } from "zod";

import { positionInput } from "./geo";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
/** <input type="datetime-local">: YYYY-MM-DDTHH:MM (waktu lokal outlet). */
const localDateTime = (label: string) =>
  z
    .string({ error: `${label} wajib diisi.` })
    .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, { error: `${label} tidak valid.` });

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${label} maksimal ${max} karakter.` })
    .optional()
    .transform((v) => v || null);

const requiredText = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} wajib diisi.` })
    .trim()
    .min(min, { error: `${label} minimal ${min} karakter.` })
    .max(max, { error: `${label} maksimal ${max} karakter.` });

export const faceSessionInput = z.object({
  purpose: z.enum(["enrollment", "check_in", "check_out"]),
});

export const attendanceSubmitInput = z.object({
  /** Id sesi verifikasi (dari server), bukan hasil verifikasi. */
  sessionId: z.uuid({ error: "Sesi verifikasi tidak valid. Ulangi verifikasi wajah." }),
  position: positionInput,
});

export const locationCheckInput = z.object({ position: positionInput });

export const consentInput = z.object({
  noticeVersion: z.string().min(1).max(40),
  agree: z.literal(true, { error: "Centang persetujuan untuk melanjutkan." }),
});

export const enrollmentCompleteInput = z.object({ sessionId: z.uuid() });

export const revokeEnrollmentInput = z.object({
  /** Kosong = milik sendiri (penarikan persetujuan). */
  employeeId: z.uuid().optional(),
  reason: requiredText(5, 300, "Alasan"),
});

export const outsideDutyInput = z
  .object({
    dutyDate: z.string().regex(datePattern, { error: "Tanggal wajib diisi." }),
    startTime: z.string().regex(timePattern, { error: "Jam mulai tidak valid." }),
    endTime: z.string().regex(timePattern, { error: "Jam selesai tidak valid." }),
    location: requiredText(3, 200, "Lokasi tugas"),
    purpose: requiredText(3, 200, "Tujuan"),
    notes: requiredText(5, 500, "Alasan"),
  })
  .refine((v) => v.endTime > v.startTime, { error: "Jam selesai harus setelah jam mulai.", path: ["endTime"] });

export const correctionInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("missing_check_out"),
    attendanceId: z.uuid({ error: "Pilih sesi yang belum check-out." }),
    checkOutAt: localDateTime("Jam pulang"),
    reason: requiredText(5, 500, "Alasan"),
  }),
  z
    .object({
      kind: z.literal("missing_attendance"),
      checkInAt: localDateTime("Jam masuk"),
      checkOutAt: localDateTime("Jam pulang"),
      reason: requiredText(5, 500, "Alasan"),
    })
    .refine((v) => v.checkOutAt > v.checkInAt, { error: "Jam pulang harus setelah jam masuk.", path: ["checkOutAt"] }),
]);
export type CorrectionInput = z.infer<typeof correctionInput>;

export const decisionInput = z.object({
  approvalId: z.uuid(),
  approve: z.boolean(),
  note: z.string().trim().max(300).optional(),
});

export const refInput = z.object({ id: z.uuid() });

export const outletGeofenceInput = z
  .object({
    outletId: z.uuid(),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    radiusMeter: z.int({ error: "Radius harus bilangan bulat." }).min(1).max(1000),
  })
  .refine((v) => (v.latitude === null) === (v.longitude === null), {
    error: "Latitude dan longitude harus diisi berpasangan.",
    path: ["longitude"],
  });

const optionalScore = z.number().min(0).max(1000).nullable();

export const attendanceSettingsInput = z.object({
  maxGpsAccuracyMeter: z.int({ error: "Akurasi harus bilangan bulat." }).min(1).max(1000),
  faceMatchThreshold: optionalScore,
  livenessThreshold: optionalScore,
  verificationProvider: z
    .string()
    .trim()
    .max(60)
    .regex(/^[a-z0-9-]*$/, { error: "Kode provider hanya huruf kecil, angka, dan minus." })
    .transform((v) => v || null),
  policyVersion: requiredText(1, 40, "Versi kebijakan"),
});

const employeeFields = {
  fullName: requiredText(2, 80, "Nama"),
  phone: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || /^[0-9+\-\s]{8,20}$/.test(v), { error: "Nomor telepon tidak valid." }),
  position: optionalText(60, "Jabatan"),
  outletId: z.uuid({ error: "Pilih outlet." }),
  joinedAt: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || datePattern.test(v), { error: "Tanggal bergabung tidak valid." }),
  /** Akun login (users) yang ditautkan; null = belum punya akun. */
  userId: z
    .string()
    .optional()
    .transform((v) => v || null)
    .pipe(z.uuid().nullable()),
};

export const employeeCreateInput = z.object({
  employeeCode: z
    .string({ error: "Employee ID wajib diisi." })
    .trim()
    .min(2, { error: "Employee ID minimal 2 karakter." })
    .max(20)
    .regex(/^[A-Za-z0-9._-]+$/, { error: "Employee ID hanya huruf, angka, titik, minus, garis bawah." })
    .transform((v) => v.toUpperCase()),
  ...employeeFields,
});

export const employeeUpdateInput = z.object({
  employeeId: z.uuid(),
  ...employeeFields,
  isActive: z.boolean(),
});

export const attendanceListParams = z.object({
  date: z.string().regex(datePattern).optional().catch(undefined),
  from: z.string().regex(datePattern).optional().catch(undefined),
  to: z.string().regex(datePattern).optional().catch(undefined),
  outlet: z.uuid().optional().catch(undefined),
  q: z.string().trim().max(60).optional().catch(undefined),
  status: z.enum(["checked_in", "working", "checked_out", "not_checked_in", "outside_duty"]).optional().catch(undefined),
  category: z.enum(["verified", "manual", "outside_duty", "incomplete"]).optional().catch(undefined),
});
