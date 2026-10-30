"use server";

import { refresh } from "next/cache";

import { db } from "@/db";
import { AccessError, type ActionResult } from "@/lib/auth/errors";
import { runAction } from "@/lib/auth/run-action";
import { getAuditContext, requireActionUser } from "@/lib/auth/session";
import { readEvidencePhoto } from "@/lib/inventory/evidence";
import { attendanceEvidenceStorage } from "@/lib/supabase/storage";

import { createEmployee, updateEmployee } from "./employees";
import {
  cancelCorrection,
  cancelOutsideDuty,
  checkIn,
  checkLocation,
  checkOut,
  completeEnrollment,
  decideCorrection,
  decideOutsideDuty,
  giveBiometricConsent,
  requestCorrection,
  requestOutsideDuty,
  revokeEnrollment,
  startFaceSession,
  updateAttendanceSettings,
  updateOutletGeofence,
} from "./engine";
import { getFaceProvider } from "./face-provider";

// Server Action absensi. Actor selalu dari session; waktu dari database;
// lokasi & hasil verifikasi diputuskan di engine — browser hanya mengirim
// koordinat mentah dan id sesi.

const minutesLabel = (minutes: number | null) =>
  minutes === null ? "" : ` Durasi ${Math.floor(minutes / 60)} jam ${minutes % 60} menit.`;

export async function checkLocationAction(input: unknown) {
  return runAction(async () => {
    const result = await checkLocation(db, await requireActionUser(), input);
    return { ok: true, data: result };
  });
}

export async function startFaceSessionAction(input: unknown) {
  return runAction(async () => {
    const session = await startFaceSession(db, await requireActionUser(), input, getFaceProvider());
    return { ok: true, data: session };
  });
}

export async function checkInAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    await checkIn(db, await requireActionUser(), input, getFaceProvider(), await getAuditContext());
    refresh();
    return { ok: true, message: "Check-in berhasil." };
  });
}

export async function checkOutAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const row = await checkOut(db, await requireActionUser(), input, getFaceProvider(), await getAuditContext());
    refresh();
    return { ok: true, message: `Check-out berhasil.${minutesLabel(row.workingMinutes)}` };
  });
}

export async function giveConsentAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    await giveBiometricConsent(db, await requireActionUser(), input, getFaceProvider(), await getAuditContext());
    refresh();
    return { ok: true, message: "Persetujuan tercatat." };
  });
}

export async function completeEnrollmentAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    await completeEnrollment(db, await requireActionUser(), input, getFaceProvider(), await getAuditContext());
    refresh();
    return { ok: true, message: "Registrasi wajah berhasil." };
  });
}

export async function revokeEnrollmentAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const result = await revokeEnrollment(db, await requireActionUser(), input, getFaceProvider(), await getAuditContext());
    refresh();
    return {
      ok: true,
      message: result.pendingProviderDeletion
        ? "Registrasi dicabut. Penghapusan di layanan verifikasi tertunda dan akan dilanjutkan admin."
        : "Registrasi dan persetujuan dicabut.",
    };
  });
}

/** FormData: field tugas luar + `evidence` (foto opsional). */
export async function requestOutsideDutyAction(form: FormData): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const actor = await requireActionUser();
    if (!(form instanceof FormData)) throw new AccessError("invalid", "Data tidak valid.");
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : undefined;
    };
    const evidence = await readEvidencePhoto(form.get("evidence"));
    await requestOutsideDuty(
      db,
      actor,
      {
        dutyDate: text("dutyDate"),
        startTime: text("startTime"),
        endTime: text("endTime"),
        location: text("location"),
        purpose: text("purpose"),
        notes: text("notes"),
      },
      evidence,
      attendanceEvidenceStorage,
      await getAuditContext(),
    );
    refresh();
    return { ok: true, message: "Tugas luar diajukan dan menunggu persetujuan." };
  });
}

export async function cancelOutsideDutyAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    await cancelOutsideDuty(db, await requireActionUser(), input, await getAuditContext());
    refresh();
    return { ok: true, message: "Pengajuan dibatalkan." };
  });
}

export async function decideOutsideDutyAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const result = await decideOutsideDuty(db, await requireActionUser(), input, await getAuditContext());
    refresh();
    return { ok: true, message: result.approved ? "Tugas luar disetujui." : "Tugas luar ditolak." };
  });
}

export async function requestCorrectionAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    await requestCorrection(db, await requireActionUser(), input, await getAuditContext());
    refresh();
    return { ok: true, message: "Koreksi diajukan dan menunggu persetujuan Manager." };
  });
}

export async function cancelCorrectionAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    await cancelCorrection(db, await requireActionUser(), input, await getAuditContext());
    refresh();
    return { ok: true, message: "Koreksi dibatalkan." };
  });
}

export async function decideCorrectionAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const result = await decideCorrection(db, await requireActionUser(), input, await getAuditContext());
    refresh();
    return { ok: true, message: result.approved ? "Koreksi disetujui (tercatat sebagai koreksi manual)." : "Koreksi ditolak." };
  });
}

export async function updateOutletGeofenceAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    await updateOutletGeofence(db, await requireActionUser(), input, await getAuditContext());
    refresh();
    return { ok: true, message: "Lokasi & radius outlet disimpan." };
  });
}

export async function updateAttendanceSettingsAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    await updateAttendanceSettings(db, await requireActionUser(), input, await getAuditContext());
    refresh();
    return { ok: true, message: "Pengaturan absensi disimpan." };
  });
}

export async function createEmployeeAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const created = await createEmployee(db, await requireActionUser(), input, await getAuditContext());
    refresh();
    return { ok: true, data: { id: created.id }, message: "Karyawan ditambahkan." };
  });
}

export async function updateEmployeeAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const result = await updateEmployee(db, await requireActionUser(), input, getFaceProvider(), await getAuditContext());
    refresh();
    return {
      ok: true,
      message: result.revoked
        ? `Karyawan diperbarui. Registrasi wajah dicabut${result.pendingProviderDeletion ? " (penghapusan di provider tertunda)" : ""}.`
        : "Karyawan diperbarui.",
    };
  });
}
