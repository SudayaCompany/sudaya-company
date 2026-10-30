import { describe, expect, it } from "vitest";

import { csvCell, toCsv } from "@/lib/attendance/csv";
import {
  evaluateEnrollment,
  evaluateVerification,
  getFaceProvider,
  providerState,
  type FaceVerificationProvider,
} from "@/lib/attendance/face-provider";
import { MAX_POSITION_AGE_MS, evaluateGeofence, haversineMeters, positionInput } from "@/lib/attendance/geo";
import { BIOMETRIC_NOTICE, BIOMETRIC_NOTICE_VERSION } from "@/lib/attendance/privacy";
import { categoryOf, methodLabel } from "@/lib/attendance/queries";
import { correctionInput, outletGeofenceInput, outsideDutyInput } from "@/lib/attendance/schemas";
import { canAccessPath, type AccessGrant } from "@/lib/auth/policy";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_CODES, type RoleCode } from "@/lib/auth/rbac";

const outlet = { latitude: -6.2, longitude: 106.816666, radiusMeter: 5 };
const at = (metersNorth: number, accuracy = 4, ageMs = 1000) => ({
  latitude: outlet.latitude + metersNorth / 111_320,
  longitude: outlet.longitude,
  accuracy,
  ageMs,
});

describe("geofence (server)", () => {
  it("Haversine: jarak great-circle yang benar", () => {
    // Monas → Bundaran HI ≈ 2,3 km
    const d = haversineMeters({ latitude: -6.175392, longitude: 106.827153 }, { latitude: -6.195004, longitude: 106.823004 });
    expect(d).toBeGreaterThan(2_150);
    expect(d).toBeLessThan(2_300);
    expect(haversineMeters(outlet, outlet)).toBe(0);
    expect(haversineMeters(outlet, at(5))).toBeCloseTo(5, 1);
  });

  it("radius 5 m, akurasi, posisi lama, dan outlet tanpa koordinat", () => {
    const base = { outlet, maxAccuracyMeter: 20, outsideDuty: false };
    expect(evaluateGeofence({ ...base, position: at(4.9) })).toMatchObject({ ok: true, mode: "outlet" });
    expect(evaluateGeofence({ ...base, position: at(5.5) })).toMatchObject({ ok: false, reason: "outside_radius" });
    expect(evaluateGeofence({ ...base, position: at(1, 25) })).toMatchObject({ ok: false, reason: "accuracy_too_low" });
    expect(evaluateGeofence({ ...base, position: at(1, 4, MAX_POSITION_AGE_MS + 1) })).toMatchObject({ ok: false, reason: "stale_position" });
    expect(
      evaluateGeofence({ ...base, outlet: { latitude: null, longitude: null, radiusMeter: 5 }, position: at(0) }),
    ).toMatchObject({ ok: false, reason: "no_outlet_coordinates" });
    // Tugas luar disetujui: geofence outlet tidak berlaku, akurasi tetap dicek.
    expect(evaluateGeofence({ ...base, outsideDuty: true, position: at(5_000) })).toMatchObject({ ok: true, mode: "outside_duty" });
    expect(evaluateGeofence({ ...base, outsideDuty: true, position: at(5_000, 80) })).toMatchObject({ ok: false, reason: "accuracy_too_low" });
    // Pesan PRD §99
    const outside = evaluateGeofence({ ...base, position: at(30) });
    expect(!outside.ok && outside.message).toMatch(/luar area absensi Sudaya Coffee/);
  });

  it("input posisi divalidasi (GPS mati / koordinat ngawur ditolak)", () => {
    expect(positionInput.safeParse(undefined).success).toBe(false);
    expect(positionInput.safeParse({ latitude: 91, longitude: 0, accuracy: 5, ageMs: 0 }).success).toBe(false);
    expect(positionInput.safeParse({ latitude: 0, longitude: 0, accuracy: 0, ageMs: 0 }).success).toBe(false);
    expect(positionInput.safeParse(at(1)).success).toBe(true);
  });
});

describe("verifikasi wajah (keputusan server)", () => {
  const thresholds = { liveness: 90, match: 95 };

  it("liveness dan face matching keduanya wajib lulus", () => {
    expect(evaluateVerification({ status: "succeeded", livenessScore: 99, matchScore: 99 }, thresholds)).toEqual({ ok: true });
    expect(evaluateVerification({ status: "succeeded", livenessScore: 80, matchScore: 99 }, thresholds)).toMatchObject({
      ok: false,
      reason: "liveness_failed",
      message: "Wajah tidak dapat diverifikasi.",
    });
    expect(evaluateVerification({ status: "succeeded", livenessScore: 99, matchScore: 90 }, thresholds)).toMatchObject({
      ok: false,
      reason: "face_mismatch",
      message: "Wajah tidak dikenali. Silakan coba kembali.",
    });
    // Liveness lulus saja tidak cukup (tanpa skor kecocokan).
    expect(evaluateVerification({ status: "succeeded", livenessScore: 99, matchScore: null }, thresholds)).toMatchObject({ ok: false });
    expect(evaluateVerification({ status: "failed", livenessScore: 99, matchScore: 99 }, thresholds)).toMatchObject({ ok: false });
    expect(evaluateEnrollment({ status: "succeeded", livenessScore: 99, subjectRef: null }, thresholds)).toMatchObject({ ok: false });
  });

  it("tanpa provider / ambang → belum dikonfigurasi; aplikasi tidak punya provider mock", () => {
    expect(getFaceProvider()).toBeNull();
    const settings = { verificationProvider: "x", liveness: 90, match: 95 };
    expect(providerState(null, settings)).toMatchObject({ ready: false, reason: "provider_unconfigured" });
    const provider = { id: "x" } as FaceVerificationProvider;
    expect(providerState(provider, { ...settings, verificationProvider: "y" })).toMatchObject({ ready: false });
    expect(providerState(provider, { ...settings, liveness: null })).toMatchObject({ ready: false, reason: "thresholds_unset" });
    expect(providerState(provider, settings)).toEqual({ ready: true });
  });
});

describe("laporan & input", () => {
  it("kategori laporan memisahkan biometrik, koreksi manual, tugas luar, belum lengkap", () => {
    const done = new Date();
    expect(categoryOf({ checkOutAt: done, checkInMethod: "biometric", checkOutMethod: "biometric", outsideDutyRequestId: null })).toBe("verified");
    expect(categoryOf({ checkOutAt: done, checkInMethod: "biometric", checkOutMethod: "manual_correction", outsideDutyRequestId: null })).toBe("manual");
    expect(categoryOf({ checkOutAt: done, checkInMethod: "biometric", checkOutMethod: "biometric", outsideDutyRequestId: "x" })).toBe("outside_duty");
    expect(categoryOf({ checkOutAt: null, checkInMethod: "biometric", checkOutMethod: null, outsideDutyRequestId: null })).toBe("incomplete");
    expect(methodLabel("biometric", "manual_correction")).toBe("Masuk biometrik, pulang koreksi manual");
    expect(methodLabel("manual_correction", "manual_correction")).toBe("Koreksi manual");
  });

  it("CSV aman dari formula injection; format Excel memakai titik koma", () => {
    expect(csvCell("=HYPERLINK(\"x\")", ",")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+62812", ",")).toBe("'+62812");
    expect(csvCell("Sari, Barista", ",")).toBe('"Sari, Barista"');
    const excel = toCsv([["a", "b;c"]], "excel");
    expect(excel.startsWith("﻿sep=;\r\n")).toBe(true);
    expect(excel).toContain('a;"b;c"');
  });

  it("validasi koreksi, tugas luar, geofence", () => {
    expect(correctionInput.safeParse({ kind: "missing_attendance", checkInAt: "2026-10-30T17:00", checkOutAt: "2026-10-30T08:00", reason: "Lupa absen" }).success).toBe(false);
    expect(correctionInput.safeParse({ kind: "missing_attendance", checkInAt: "2026-10-30T08:00", checkOutAt: "2026-10-30T17:00", reason: "x" }).success).toBe(false);
    expect(correctionInput.safeParse({ kind: "missing_check_out", attendanceId: "bukan-uuid", checkOutAt: "2026-10-30T17:00", reason: "Lupa pulang" }).success).toBe(false);
    expect(outsideDutyInput.safeParse({ dutyDate: "2026-10-30", startTime: "15:00", endTime: "09:00", location: "Supplier", purpose: "Belanja", notes: "Stok habis" }).success).toBe(false);
    expect(outletGeofenceInput.safeParse({ outletId: crypto.randomUUID(), latitude: -6.2, longitude: null, radiusMeter: 5 }).success).toBe(false);
    expect(outletGeofenceInput.safeParse({ outletId: crypto.randomUUID(), latitude: -6.2, longitude: 106.8, radiusMeter: 0 }).success).toBe(false);
  });

  it("pemberitahuan privasi berversi & mencakup tujuan, dasar, retensi, hak", () => {
    expect(BIOMETRIC_NOTICE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const titles = BIOMETRIC_NOTICE.map((s) => s.title).join(" ");
    for (const word of ["Tujuan", "Dasar", "Retensi", "Hak"]) expect(titles).toContain(word);
  });
});

describe("akses halaman absensi", () => {
  const grant = (roleCode: RoleCode, outletId: string | null = "o1"): AccessGrant => ({
    userRoleId: "x",
    roleId: roleCode,
    roleCode,
    roleName: roleCode,
    outletId,
    permissions: roleCode === "super_admin" ? PERMISSION_CODES : DEFAULT_ROLE_PERMISSIONS[roleCode as Exclude<RoleCode, "super_admin">],
  });
  const subject = (...grants: AccessGrant[]) => ({ grants });

  it("staf absensi, admin dashboard, laporan, pengaturan sesuai permission", () => {
    const barista = subject(grant("barista"));
    const manager = subject(grant("manager"));
    const owner = subject(grant("owner", null));
    const superAdmin = subject(grant("super_admin", null));
    expect(canAccessPath(barista, "/staff/attendance")).toBe(true);
    expect(canAccessPath(barista, "/staff/face-enrollment")).toBe(true);
    expect(canAccessPath(barista, "/admin/attendance")).toBe(false);
    expect(canAccessPath(barista, "/admin/employees")).toBe(false);
    expect(canAccessPath(owner, "/staff/attendance")).toBe(false); // owner tidak absen
    expect(canAccessPath(manager, "/admin/attendance")).toBe(true);
    expect(canAccessPath(manager, "/admin/attendance/reports")).toBe(true);
    expect(canAccessPath(manager, "/admin/outside-duty")).toBe(true);
    expect(canAccessPath(manager, "/admin/attendance/settings")).toBe(false); // Super Admin saja
    expect(canAccessPath(superAdmin, "/admin/attendance/settings")).toBe(true);
  });
});
