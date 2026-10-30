// Engine absensi (PRD §8–§16, §69, §82). Pola sama dengan order & inventory:
// actor dari session, permission + scope outlet dicek ulang di sini, input
// divalidasi Zod, waktu SELALU dari database, perubahan dicatat di audit log.
//
// Alur check-in/out: sesi verifikasi wajah diterbitkan server untuk satu
// karyawan → SDK provider di browser menjalankan liveness → server mengambil
// hasil liveness + face matching dari provider dan memutuskan dengan ambang
// tersimpan → geofence dihitung ulang di server → absensi disimpan dalam
// transaksi bersama konsumsi sesi (satu sesi = satu absensi).

import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database, DbExecutor } from "@/db/client";
import {
  approvals,
  attendanceCorrections,
  attendanceSettings,
  attendances,
  biometricConsents,
  employees,
  faceEnrollments,
  faceVerificationSessions,
  outlets,
  outsideDutyRequests,
} from "@/db/schema";
import { recordAudit, type AuditContext, type AuditEntry } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth/access";
import { AccessError } from "@/lib/auth/errors";
import { hasPermission } from "@/lib/auth/policy";
import type { Permission } from "@/lib/auth/rbac";
import { evidencePath, type EvidencePhoto, type EvidenceStorage } from "@/lib/inventory/evidence";

import {
  evaluateEnrollment,
  evaluateVerification,
  providerState,
  type FaceVerificationProvider,
} from "./face-provider";
import { evaluateGeofence, type PositionInput } from "./geo";
import { BIOMETRIC_BASIS, BIOMETRIC_NOTICE_VERSION } from "./privacy";
import {
  attendanceSettingsInput,
  attendanceSubmitInput,
  consentInput,
  correctionInput,
  decisionInput,
  enrollmentCompleteInput,
  faceSessionInput,
  locationCheckInput,
  outletGeofenceInput,
  outsideDutyInput,
  refInput,
  revokeEnrollmentInput,
} from "./schemas";

const forbidden = () => new AccessError("forbidden", "Anda tidak memiliki izin untuk tindakan ini.");
const notFound = () => new AccessError("not_found", "Data tidak ditemukan.");

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AccessError("invalid", result.error.issues[0]?.message ?? "Input tidak valid.");
  }
  return result.data;
}

function assertAt(actor: CurrentUser, permission: Permission, outletId: string | null) {
  if (!actor.isActive || !hasPermission(actor, permission, { outletId })) throw forbidden();
}

const UNIQUE_MESSAGES: Record<string, string> = {
  attendances_one_open_per_employee: "Anda masih tercatat check-in. Lakukan check-out terlebih dahulu.",
  face_enrollments_one_active_per_employee: "Wajah sudah terdaftar. Cabut registrasi lama untuk mendaftar ulang.",
  employees_companyId_employeeCode_unique: "Employee ID sudah dipakai karyawan lain.",
  employees_user_id_unique: "Akun ini sudah ditautkan ke karyawan lain.",
};

function mapUniqueViolation(error: unknown): never {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    const e = current as { code?: string; constraint_name?: string; cause?: unknown };
    if (e.code === "23505") {
      throw new AccessError("conflict", UNIQUE_MESSAGES[e.constraint_name ?? ""] ?? "Data sudah ada.");
    }
    current = e.cause;
  }
  throw error;
}

// --- Pengaturan -------------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  maxGpsAccuracyMeter: 20,
  faceMatchThreshold: null as number | null,
  livenessThreshold: null as number | null,
  verificationProvider: null as string | null,
  policyVersion: "2026-10-30",
};
export type AttendanceSettings = typeof DEFAULT_SETTINGS;

export async function loadSettings(db: DbExecutor, companyId: string): Promise<AttendanceSettings> {
  const [row] = await db
    .select({
      maxGpsAccuracyMeter: attendanceSettings.maxGpsAccuracyMeter,
      faceMatchThreshold: attendanceSettings.faceMatchThreshold,
      livenessThreshold: attendanceSettings.livenessThreshold,
      verificationProvider: attendanceSettings.verificationProvider,
      policyVersion: attendanceSettings.policyVersion,
    })
    .from(attendanceSettings)
    .where(eq(attendanceSettings.companyId, companyId))
    .limit(1);
  return row ?? DEFAULT_SETTINGS;
}

const stateOf = (provider: FaceVerificationProvider | null, settings: AttendanceSettings) =>
  providerState(provider, {
    verificationProvider: settings.verificationProvider,
    liveness: settings.livenessThreshold,
    match: settings.faceMatchThreshold,
  });

// --- Karyawan milik actor -----------------------------------------------------------

const employeeColumns = {
  id: employees.id,
  companyId: employees.companyId,
  brandId: employees.brandId,
  outletId: employees.outletId,
  userId: employees.userId,
  employeeCode: employees.employeeCode,
  fullName: employees.fullName,
  isActive: employees.isActive,
  outletName: outlets.name,
  outletActive: outlets.isActive,
  timezone: outlets.timezone,
  latitude: outlets.latitude,
  longitude: outlets.longitude,
  radiusMeter: outlets.attendanceRadiusMeter,
};

/** Profil karyawan yang ditautkan ke akun login actor (null = belum ditautkan). */
export async function findSelfEmployee(db: DbExecutor, actor: CurrentUser) {
  const [row] = await db
    .select(employeeColumns)
    .from(employees)
    .innerJoin(outlets, eq(outlets.id, employees.outletId))
    .where(and(eq(employees.userId, actor.id), eq(employees.companyId, actor.company.id)))
    .limit(1);
  return row ?? null;
}
export type SelfEmployee = NonNullable<Awaited<ReturnType<typeof findSelfEmployee>>>;

/** Hanya akun aktif + karyawan aktif + outlet aktif yang boleh absen. */
async function requireSelfEmployee(db: DbExecutor, actor: CurrentUser, permission: Permission) {
  const employee = await findSelfEmployee(db, actor);
  if (!employee) {
    throw new AccessError("forbidden", "Akun Anda belum terhubung ke data karyawan. Hubungi admin.");
  }
  assertAt(actor, permission, employee.outletId);
  if (!employee.isActive) throw new AccessError("forbidden", "Status karyawan Anda nonaktif.");
  if (!employee.outletActive) throw new AccessError("forbidden", "Outlet Anda sedang nonaktif.");
  return employee;
}

async function activeEnrollment(db: DbExecutor, employeeId: string) {
  const [row] = await db
    .select()
    .from(faceEnrollments)
    .where(and(eq(faceEnrollments.employeeId, employeeId), isNull(faceEnrollments.revokedAt)))
    .limit(1);
  return row ?? null;
}

async function activeConsent(db: DbExecutor, employeeId: string) {
  const [row] = await db
    .select()
    .from(biometricConsents)
    .where(
      and(
        eq(biometricConsents.employeeId, employeeId),
        isNull(biometricConsents.withdrawnAt),
        eq(biometricConsents.noticeVersion, BIOMETRIC_NOTICE_VERSION),
      ),
    )
    .orderBy(desc(biometricConsents.givenAt))
    .limit(1);
  return row ?? null;
}

/** Tugas luar disetujui yang sedang berlangsung (waktu DB). */
async function activeOutsideDuty(db: DbExecutor, employeeId: string) {
  const [row] = await db
    .select({ id: outsideDutyRequests.id, location: outsideDutyRequests.location, endsAt: outsideDutyRequests.endsAt })
    .from(outsideDutyRequests)
    .innerJoin(approvals, eq(approvals.id, outsideDutyRequests.approvalId))
    .where(
      and(
        eq(outsideDutyRequests.employeeId, employeeId),
        eq(approvals.status, "approved"),
        lte(outsideDutyRequests.startsAt, sql`now()`),
        gt(outsideDutyRequests.endsAt, sql`now()`),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function openAttendance(db: DbExecutor, employeeId: string) {
  const [row] = await db
    .select({
      id: attendances.id,
      outletId: attendances.outletId,
      businessDate: attendances.businessDate,
      checkInAt: attendances.checkInAt,
      checkInMethod: attendances.checkInMethod,
      outsideDutyRequestId: attendances.outsideDutyRequestId,
    })
    .from(attendances)
    .where(and(eq(attendances.employeeId, employeeId), isNull(attendances.checkOutAt)))
    .limit(1);
  return row ?? null;
}

const auditOf = (employee: { companyId: string; brandId: string; outletId: string }, actor: CurrentUser) => ({
  companyId: employee.companyId,
  brandId: employee.brandId,
  outletId: employee.outletId,
  actorId: actor.id,
});

// --- Ringkasan untuk halaman staf ------------------------------------------------------

export async function getStaffAttendanceState(
  db: DbExecutor,
  actor: CurrentUser,
  provider: FaceVerificationProvider | null,
) {
  const employee = await findSelfEmployee(db, actor);
  const settings = await loadSettings(db, actor.company.id);
  const state = stateOf(provider, settings);
  if (!employee) return { employee: null, settings, providerState: state } as const;

  const [enrollment, consent, open, outsideDuty, today] = await Promise.all([
    activeEnrollment(db, employee.id),
    activeConsent(db, employee.id),
    openAttendance(db, employee.id),
    activeOutsideDuty(db, employee.id),
    db
      .select({
        id: attendances.id,
        checkInAt: attendances.checkInAt,
        checkOutAt: attendances.checkOutAt,
        workingMinutes: attendances.workingMinutes,
        checkInMethod: attendances.checkInMethod,
        checkOutMethod: attendances.checkOutMethod,
      })
      .from(attendances)
      .where(
        and(
          eq(attendances.employeeId, employee.id),
          eq(attendances.businessDate, sql`(now() at time zone ${employee.timezone})::date`),
        ),
      )
      .orderBy(attendances.checkInAt),
  ]);
  const [{ today: businessToday }] = (await db.execute(
    sql`select (now() at time zone ${employee.timezone})::date::text as today`,
  )) as unknown as { today: string }[];

  return {
    employee,
    settings,
    providerState: state,
    enrollment: enrollment
      ? { id: enrollment.id, provider: enrollment.provider, createdAt: enrollment.createdAt }
      : null,
    consent: consent ? { id: consent.id, givenAt: consent.givenAt, noticeVersion: consent.noticeVersion } : null,
    open,
    outsideDuty,
    today,
    businessToday,
  } as const;
}

/** Pratinjau jarak & akurasi (tidak mencatat apa pun). Keputusan final tetap saat submit. */
export async function checkLocation(db: DbExecutor, actor: CurrentUser, raw: unknown) {
  const input = parse(locationCheckInput, raw);
  const employee = await requireSelfEmployee(db, actor, "attendance.checkin");
  const settings = await loadSettings(db, actor.company.id);
  const outsideDuty = await activeOutsideDuty(db, employee.id);
  const decision = evaluateGeofence({
    position: input.position,
    outlet: { latitude: employee.latitude, longitude: employee.longitude, radiusMeter: employee.radiusMeter },
    maxAccuracyMeter: settings.maxGpsAccuracyMeter,
    outsideDuty: Boolean(outsideDuty),
  });
  return {
    ...decision,
    accuracyMeter: input.position.accuracy,
    radiusMeter: employee.radiusMeter,
    maxAccuracyMeter: settings.maxGpsAccuracyMeter,
  };
}

// --- Sesi verifikasi wajah -----------------------------------------------------------------

const SESSION_PERMISSION: Record<"enrollment" | "check_in" | "check_out", Permission> = {
  enrollment: "attendance.checkin",
  check_in: "attendance.checkin",
  check_out: "attendance.checkout",
};

export async function startFaceSession(
  db: Database,
  actor: CurrentUser,
  raw: unknown,
  provider: FaceVerificationProvider | null,
) {
  const input = parse(faceSessionInput, raw);
  const employee = await requireSelfEmployee(db, actor, SESSION_PERMISSION[input.purpose]);
  const settings = await loadSettings(db, actor.company.id);
  const state = stateOf(provider, settings);
  if (!state.ready) throw new AccessError("conflict", state.message);

  if (input.purpose === "enrollment") {
    if (!(await activeConsent(db, employee.id))) {
      throw new AccessError("forbidden", "Berikan persetujuan pemrosesan data biometrik terlebih dahulu.");
    }
    if (await activeEnrollment(db, employee.id)) {
      throw new AccessError("conflict", UNIQUE_MESSAGES.face_enrollments_one_active_per_employee);
    }
  } else if (!(await activeEnrollment(db, employee.id))) {
    throw new AccessError("forbidden", "Wajah Anda belum terdaftar. Lakukan registrasi wajah terlebih dahulu.");
  }

  const session = await provider!.createSession({ purpose: input.purpose, employeeRef: employee.id });
  const [row] = await db
    .insert(faceVerificationSessions)
    .values({
      companyId: employee.companyId,
      brandId: employee.brandId,
      outletId: employee.outletId,
      employeeId: employee.id,
      purpose: input.purpose,
      provider: provider!.id,
      providerSessionId: session.providerSessionId,
      expiresAt: session.expiresAt,
    })
    .returning({ id: faceVerificationSessions.id });
  return { sessionId: row.id, provider: provider!.id, client: session.client };
}

/** Sesi milik karyawan ini, tujuan sesuai, belum dipakai & belum kedaluwarsa (waktu DB). */
async function loadUsableSession(
  db: DbExecutor,
  employeeId: string,
  sessionId: string,
  purpose: "enrollment" | "check_in" | "check_out",
) {
  const [session] = await db
    .select({
      id: faceVerificationSessions.id,
      provider: faceVerificationSessions.provider,
      providerSessionId: faceVerificationSessions.providerSessionId,
      status: faceVerificationSessions.status,
      purpose: faceVerificationSessions.purpose,
      employeeId: faceVerificationSessions.employeeId,
      expired: sql<boolean>`${faceVerificationSessions.expiresAt} <= now()`,
    })
    .from(faceVerificationSessions)
    .where(eq(faceVerificationSessions.id, sessionId))
    .limit(1);
  if (!session || session.employeeId !== employeeId || session.purpose !== purpose) {
    throw new AccessError("forbidden", "Sesi verifikasi tidak valid. Ulangi verifikasi wajah.");
  }
  if (session.status !== "issued") {
    throw new AccessError("conflict", "Sesi verifikasi sudah dipakai. Ulangi verifikasi wajah.");
  }
  if (session.expired) {
    throw new AccessError("conflict", "Sesi verifikasi kedaluwarsa. Ulangi verifikasi wajah.");
  }
  return session;
}

/** Tandai sesi dipakai; hanya satu transaksi yang bisa menang. */
async function consumeSession(tx: DbExecutor, sessionId: string, scores: { liveness: number | null; match: number | null }) {
  const [row] = await tx
    .update(faceVerificationSessions)
    .set({ status: "consumed", consumedAt: sql`now()`, livenessScore: scores.liveness, matchScore: scores.match })
    .where(and(eq(faceVerificationSessions.id, sessionId), eq(faceVerificationSessions.status, "issued")))
    .returning({ id: faceVerificationSessions.id });
  if (!row) throw new AccessError("conflict", "Sesi verifikasi sudah dipakai. Ulangi verifikasi wajah.");
}

/** Kegagalan verifikasi dicatat proporsional: alasan + skor, tanpa gambar/template. */
async function recordVerificationFailure(
  db: DbExecutor,
  employee: SelfEmployee,
  actor: CurrentUser,
  params: { sessionId: string; purpose: string; reason: string; liveness: number | null; match: number | null },
  context: AuditContext,
) {
  await db
    .update(faceVerificationSessions)
    .set({ status: "failed", failureReason: params.reason, livenessScore: params.liveness, matchScore: params.match })
    .where(and(eq(faceVerificationSessions.id, params.sessionId), eq(faceVerificationSessions.status, "issued")));
  await recordAudit(
    db,
    {
      ...auditOf(employee, actor),
      action: "attendance.verification_failed",
      entityType: "employee",
      entityId: employee.id,
      after: { purpose: params.purpose, reason: params.reason },
    },
    context,
  );
}

// --- Persetujuan, enrollment, pencabutan ------------------------------------------------------

export async function giveBiometricConsent(
  db: Database,
  actor: CurrentUser,
  raw: unknown,
  provider: FaceVerificationProvider | null,
  context: AuditContext,
) {
  const input = parse(consentInput, raw);
  const employee = await requireSelfEmployee(db, actor, "attendance.checkin");
  if (input.noticeVersion !== BIOMETRIC_NOTICE_VERSION) {
    throw new AccessError("conflict", "Pemberitahuan privasi sudah diperbarui. Muat ulang dan baca kembali.");
  }
  // Persetujuan baru diminta jika layanan memang tersedia (tidak mengumpulkan
  // persetujuan untuk pemrosesan yang belum bisa dilakukan).
  const state = stateOf(provider, await loadSettings(db, actor.company.id));
  if (!state.ready) throw new AccessError("conflict", state.message);
  const existing = await activeConsent(db, employee.id);
  if (existing) return { consentId: existing.id };

  return db.transaction(async (tx) => {
    const [consent] = await tx
      .insert(biometricConsents)
      .values({
        companyId: employee.companyId,
        brandId: employee.brandId,
        outletId: employee.outletId,
        employeeId: employee.id,
        noticeVersion: BIOMETRIC_NOTICE_VERSION,
        basis: BIOMETRIC_BASIS,
        ip: context.ip?.slice(0, 64) ?? null,
        userAgent: context.userAgent?.slice(0, 512) ?? null,
      })
      .returning({ id: biometricConsents.id });
    await recordAudit(
      tx,
      {
        ...auditOf(employee, actor),
        action: "biometric.consent_given",
        entityType: "employee",
        entityId: employee.id,
        after: { noticeVersion: BIOMETRIC_NOTICE_VERSION, basis: BIOMETRIC_BASIS },
      },
      context,
    );
    return { consentId: consent.id };
  });
}

export async function completeEnrollment(
  db: Database,
  actor: CurrentUser,
  raw: unknown,
  provider: FaceVerificationProvider | null,
  context: AuditContext,
) {
  const input = parse(enrollmentCompleteInput, raw);
  const employee = await requireSelfEmployee(db, actor, "attendance.checkin");
  const settings = await loadSettings(db, actor.company.id);
  const state = stateOf(provider, settings);
  if (!state.ready) throw new AccessError("conflict", state.message);
  const consent = await activeConsent(db, employee.id);
  if (!consent) throw new AccessError("forbidden", "Berikan persetujuan pemrosesan data biometrik terlebih dahulu.");
  const session = await loadUsableSession(db, employee.id, input.sessionId, "enrollment");

  const outcome = await provider!.completeEnrollment({
    providerSessionId: session.providerSessionId,
    employeeRef: employee.id,
  });
  const decision = evaluateEnrollment(outcome, { liveness: settings.livenessThreshold! });
  if (!decision.ok) {
    await recordVerificationFailure(db, employee, actor, {
      sessionId: session.id,
      purpose: "enrollment",
      reason: decision.reason,
      liveness: outcome.livenessScore,
      match: null,
    }, context);
    throw new AccessError("invalid", decision.message);
  }

  try {
    return await db.transaction(async (tx) => {
      await consumeSession(tx, session.id, { liveness: outcome.livenessScore, match: null });
      const [enrollment] = await tx
        .insert(faceEnrollments)
        .values({
          employeeId: employee.id,
          provider: provider!.id,
          externalFaceId: outcome.subjectRef!,
          consentAt: consent.givenAt,
          consentId: consent.id,
          createdBy: actor.id,
        })
        .returning({ id: faceEnrollments.id });
      await recordAudit(
        tx,
        {
          ...auditOf(employee, actor),
          action: "biometric.enrollment_created",
          entityType: "employee",
          entityId: employee.id,
          // Tanpa referensi template/gambar: cukup provider & id enrollment.
          after: { enrollmentId: enrollment.id, provider: provider!.id },
        },
        context,
      );
      return { enrollmentId: enrollment.id };
    });
  } catch (error) {
    mapUniqueViolation(error);
  }
}

/**
 * Cabut enrollment: oleh karyawan sendiri (sekaligus menarik persetujuan)
 * atau admin dengan employee.edit. Template di provider dihapus bila provider
 * yang sama tersedia; jika belum bisa, providerDeletedAt tetap null (tertunda).
 */
export async function revokeEnrollment(
  db: Database,
  actor: CurrentUser,
  raw: unknown,
  provider: FaceVerificationProvider | null,
  context: AuditContext,
) {
  const input = parse(revokeEnrollmentInput, raw);
  const self = await findSelfEmployee(db, actor);
  let employee: { id: string; companyId: string; brandId: string; outletId: string };
  if (!input.employeeId || input.employeeId === self?.id) {
    if (!self) throw new AccessError("forbidden", "Akun Anda belum terhubung ke data karyawan.");
    employee = self;
  } else {
    const [row] = await db
      .select({ id: employees.id, companyId: employees.companyId, brandId: employees.brandId, outletId: employees.outletId })
      .from(employees)
      .where(and(eq(employees.id, input.employeeId), eq(employees.companyId, actor.company.id)))
      .limit(1);
    if (!row) throw notFound();
    assertAt(actor, "employee.edit", row.outletId);
    employee = row;
  }
  const isSelf = employee.id === self?.id;
  return revokeEnrollmentFor(db, actor, employee, { reason: input.reason, withdrawConsent: isSelf }, provider, context);
}

export async function revokeEnrollmentFor(
  db: Database,
  actor: CurrentUser,
  employee: { id: string; companyId: string; brandId: string; outletId: string },
  options: { reason: string; withdrawConsent: boolean },
  provider: FaceVerificationProvider | null,
  context: AuditContext,
) {
  const revoked = await db.transaction(async (tx) => {
    const rows = await tx
      .update(faceEnrollments)
      .set({ revokedAt: sql`now()`, revokedBy: actor.id, revokedReason: options.reason })
      .where(and(eq(faceEnrollments.employeeId, employee.id), isNull(faceEnrollments.revokedAt)))
      .returning({ id: faceEnrollments.id, provider: faceEnrollments.provider, subjectRef: faceEnrollments.externalFaceId });
    let consentsWithdrawn = 0;
    if (options.withdrawConsent) {
      const withdrawn = await tx
        .update(biometricConsents)
        .set({ withdrawnAt: sql`now()` })
        .where(and(eq(biometricConsents.employeeId, employee.id), isNull(biometricConsents.withdrawnAt)))
        .returning({ id: biometricConsents.id });
      consentsWithdrawn = withdrawn.length;
    }
    if (rows.length === 0 && consentsWithdrawn === 0) return [];
    await recordAudit(
      tx,
      {
        ...auditOf(employee, actor),
        action: rows.length ? "biometric.enrollment_revoked" : "biometric.consent_withdrawn",
        entityType: "employee",
        entityId: employee.id,
        after: { enrollments: rows.length, consentWithdrawn: consentsWithdrawn > 0 },
        reason: options.reason,
      },
      context,
    );
    return rows;
  });

  let pendingProviderDeletion = 0;
  for (const enrollment of revoked) {
    if (provider && provider.id === enrollment.provider) {
      try {
        await provider.revokeEnrollment({ subjectRef: enrollment.subjectRef });
        await db
          .update(faceEnrollments)
          .set({ providerDeletedAt: sql`now()` })
          .where(eq(faceEnrollments.id, enrollment.id));
        continue;
      } catch {
        // dicoba ulang lewat proses retensi; status tetap tertunda
      }
    }
    pendingProviderDeletion++;
  }
  return { revoked: revoked.length, pendingProviderDeletion };
}

// --- Check-in / check-out -----------------------------------------------------------------------

type Verified = {
  session: Awaited<ReturnType<typeof loadUsableSession>>;
  liveness: number | null;
  match: number | null;
};

/** Validasi lokasi lalu verifikasi wajah lewat provider; melempar dengan pesan PRD §98–§99. */
async function verifyAttempt(
  db: Database,
  actor: CurrentUser,
  employee: SelfEmployee,
  params: {
    purpose: "check_in" | "check_out";
    sessionId: string;
    position: PositionInput;
    geofenceOutlet: { latitude: number | null; longitude: number | null; radiusMeter: number };
    outsideDuty: boolean;
  },
  provider: FaceVerificationProvider | null,
  context: AuditContext,
) {
  const settings = await loadSettings(db, actor.company.id);
  const state = stateOf(provider, settings);
  if (!state.ready) throw new AccessError("conflict", state.message);
  const enrollment = await activeEnrollment(db, employee.id);
  if (!enrollment) {
    throw new AccessError("forbidden", "Wajah Anda belum terdaftar. Lakukan registrasi wajah terlebih dahulu.");
  }
  if (enrollment.provider !== provider!.id) {
    throw new AccessError("conflict", "Registrasi wajah dibuat di layanan lain. Lakukan registrasi ulang.");
  }
  const session = await loadUsableSession(db, employee.id, params.sessionId, params.purpose);

  const geofence = evaluateGeofence({
    position: params.position,
    outlet: params.geofenceOutlet,
    maxAccuracyMeter: settings.maxGpsAccuracyMeter,
    outsideDuty: params.outsideDuty,
  });
  if (!geofence.ok) {
    await recordAudit(
      db,
      {
        ...auditOf(employee, actor),
        action: "attendance.location_rejected",
        entityType: "employee",
        entityId: employee.id,
        after: {
          purpose: params.purpose,
          reason: geofence.reason,
          accuracyMeter: Math.round(params.position.accuracy),
          distanceMeter: geofence.distanceMeter === null ? null : Math.round(geofence.distanceMeter),
        },
      },
      context,
    );
    throw new AccessError("invalid", geofence.message);
  }

  const outcome = await provider!.verify({ providerSessionId: session.providerSessionId, subjectRef: enrollment.externalFaceId });
  const decision = evaluateVerification(outcome, {
    liveness: settings.livenessThreshold!,
    match: settings.faceMatchThreshold!,
  });
  if (!decision.ok) {
    await recordVerificationFailure(db, employee, actor, {
      sessionId: session.id,
      purpose: params.purpose,
      reason: decision.reason,
      liveness: outcome.livenessScore,
      match: outcome.matchScore,
    }, context);
    throw new AccessError("invalid", decision.message);
  }
  return {
    verified: { session, liveness: outcome.livenessScore, match: outcome.matchScore } satisfies Verified,
    distanceMeter: geofence.distanceMeter,
    settings,
  };
}

export async function checkIn(
  db: Database,
  actor: CurrentUser,
  raw: unknown,
  provider: FaceVerificationProvider | null,
  context: AuditContext,
) {
  const input = parse(attendanceSubmitInput, raw);
  const employee = await requireSelfEmployee(db, actor, "attendance.checkin");
  if (await openAttendance(db, employee.id)) {
    throw new AccessError("conflict", UNIQUE_MESSAGES.attendances_one_open_per_employee);
  }
  const outsideDuty = await activeOutsideDuty(db, employee.id);
  const { verified, distanceMeter, settings } = await verifyAttempt(
    db,
    actor,
    employee,
    {
      purpose: "check_in",
      sessionId: input.sessionId,
      position: input.position,
      geofenceOutlet: { latitude: employee.latitude, longitude: employee.longitude, radiusMeter: employee.radiusMeter },
      outsideDuty: Boolean(outsideDuty),
    },
    provider,
    context,
  );

  try {
    return await db.transaction(async (tx) => {
      await consumeSession(tx, verified.session.id, { liveness: verified.liveness, match: verified.match });
      const [row] = await tx
        .insert(attendances)
        .values({
          companyId: employee.companyId,
          brandId: employee.brandId,
          outletId: employee.outletId,
          employeeId: employee.id,
          businessDate: sql`(now() at time zone ${employee.timezone})::date`,
          outsideDutyRequestId: outsideDuty?.id ?? null,
          policyVersion: settings.policyVersion,
          checkInMethod: "biometric",
          checkInLatitude: input.position.latitude,
          checkInLongitude: input.position.longitude,
          checkInAccuracyMeter: input.position.accuracy,
          checkInDistanceMeter: distanceMeter,
          checkInFaceScore: verified.match,
          checkInLivenessScore: verified.liveness,
          checkInVerificationId: verified.session.id,
          checkInDevice: context.userAgent?.slice(0, 512) ?? null,
          checkInIp: context.ip?.slice(0, 64) ?? null,
        })
        .returning({ id: attendances.id, checkInAt: attendances.checkInAt, businessDate: attendances.businessDate });
      await recordAudit(
        tx,
        {
          ...auditOf(employee, actor),
          action: "attendance.check_in",
          entityType: "attendance",
          entityId: row.id,
          after: {
            method: "biometric",
            outsideDuty: Boolean(outsideDuty),
            distanceMeter: distanceMeter === null ? null : Math.round(distanceMeter * 10) / 10,
            accuracyMeter: Math.round(input.position.accuracy),
          },
        },
        context,
      );
      return row;
    });
  } catch (error) {
    mapUniqueViolation(error);
  }
}

export async function checkOut(
  db: Database,
  actor: CurrentUser,
  raw: unknown,
  provider: FaceVerificationProvider | null,
  context: AuditContext,
) {
  const input = parse(attendanceSubmitInput, raw);
  const employee = await requireSelfEmployee(db, actor, "attendance.checkout");
  const open = await openAttendance(db, employee.id);
  if (!open) throw new AccessError("conflict", "Tidak ada sesi check-in yang masih terbuka.");

  // Geofence mengikuti outlet tempat sesi dibuka.
  const [outlet] = await db
    .select({ latitude: outlets.latitude, longitude: outlets.longitude, radiusMeter: outlets.attendanceRadiusMeter })
    .from(outlets)
    .where(eq(outlets.id, open.outletId));
  const outsideDuty = await activeOutsideDuty(db, employee.id);
  const { verified, distanceMeter } = await verifyAttempt(
    db,
    actor,
    employee,
    {
      purpose: "check_out",
      sessionId: input.sessionId,
      position: input.position,
      geofenceOutlet: outlet,
      outsideDuty: Boolean(outsideDuty) || Boolean(open.outsideDutyRequestId),
    },
    provider,
    context,
  );

  return db.transaction(async (tx) => {
    await consumeSession(tx, verified.session.id, { liveness: verified.liveness, match: verified.match });
    // Kondisional: dua check-out bersamaan → hanya satu yang mengubah baris.
    const [row] = await tx
      .update(attendances)
      .set({
        status: "checked_out",
        checkOutAt: sql`now()`,
        checkOutMethod: "biometric",
        checkOutLatitude: input.position.latitude,
        checkOutLongitude: input.position.longitude,
        checkOutAccuracyMeter: input.position.accuracy,
        checkOutDistanceMeter: distanceMeter,
        checkOutFaceScore: verified.match,
        checkOutLivenessScore: verified.liveness,
        checkOutVerificationId: verified.session.id,
        checkOutDevice: context.userAgent?.slice(0, 512) ?? null,
        checkOutIp: context.ip?.slice(0, 64) ?? null,
        workingMinutes: sql`floor(extract(epoch from (now() - ${attendances.checkInAt})) / 60)::int`,
      })
      .where(and(eq(attendances.id, open.id), isNull(attendances.checkOutAt)))
      .returning({ id: attendances.id, checkOutAt: attendances.checkOutAt, workingMinutes: attendances.workingMinutes });
    if (!row) throw new AccessError("conflict", "Sesi ini sudah check-out.");
    await recordAudit(
      tx,
      {
        ...auditOf(employee, actor),
        action: "attendance.check_out",
        entityType: "attendance",
        entityId: row.id,
        after: {
          method: "biometric",
          workingMinutes: row.workingMinutes,
          distanceMeter: distanceMeter === null ? null : Math.round(distanceMeter * 10) / 10,
          accuracyMeter: Math.round(input.position.accuracy),
        },
      },
      context,
    );
    return row;
  });
}

// --- Tugas luar ------------------------------------------------------------------------------------

export async function requestOutsideDuty(
  db: Database,
  actor: CurrentUser,
  raw: unknown,
  evidence: EvidencePhoto | null,
  storage: EvidenceStorage,
  context: AuditContext,
) {
  const input = parse(outsideDutyInput, raw);
  const employee = await requireSelfEmployee(db, actor, "attendance.checkin");
  const [rawWindow] = (await db.execute(sql`
    select
      (extract(epoch from (${input.dutyDate}::date + ${input.startTime}::time) at time zone ${employee.timezone}) * 1000)::bigint::text as starts_ms,
      (extract(epoch from (${input.dutyDate}::date + ${input.endTime}::time) at time zone ${employee.timezone}) * 1000)::bigint::text as ends_ms,
      ${input.dutyDate}::date < (now() at time zone ${employee.timezone})::date as in_past
  `)) as unknown as { starts_ms: string; ends_ms: string; in_past: boolean }[];
  if (rawWindow.in_past) throw new AccessError("invalid", "Tanggal tugas luar tidak boleh di masa lalu.");
  const window = { startsAt: new Date(Number(rawWindow.starts_ms)), endsAt: new Date(Number(rawWindow.ends_ms)) };

  const path = evidence ? evidencePath(employee.companyId, employee.outletId, evidence.ext) : null;
  if (evidence && path) await storage.upload(path, evidence.bytes, evidence.contentType);
  try {
    return await db.transaction(async (tx) => {
      const [overlap] = await tx
        .select({ id: outsideDutyRequests.id })
        .from(outsideDutyRequests)
        .innerJoin(approvals, eq(approvals.id, outsideDutyRequests.approvalId))
        .where(
          and(
            eq(outsideDutyRequests.employeeId, employee.id),
            sql`${approvals.status} in ('pending', 'approved')`,
            sql`${outsideDutyRequests.startsAt} < ${window.endsAt.toISOString()}::timestamptz and ${outsideDutyRequests.endsAt} > ${window.startsAt.toISOString()}::timestamptz`,
          ),
        )
        .limit(1);
      if (overlap) throw new AccessError("conflict", "Sudah ada pengajuan tugas luar pada jam tersebut.");

      const [request] = await tx
        .insert(outsideDutyRequests)
        .values({
          companyId: employee.companyId,
          brandId: employee.brandId,
          outletId: employee.outletId,
          employeeId: employee.id,
          dutyDate: input.dutyDate,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          location: input.location,
          purpose: input.purpose,
          notes: input.notes,
          evidencePath: path,
          createdBy: actor.id,
        })
        .returning({ id: outsideDutyRequests.id });
      const [approval] = await tx
        .insert(approvals)
        .values({
          companyId: employee.companyId,
          brandId: employee.brandId,
          outletId: employee.outletId,
          type: "outside_duty",
          referenceId: request.id,
          reason: `${input.purpose} — ${input.location}`,
          requestedBy: actor.id,
        })
        .returning({ id: approvals.id });
      await tx.update(outsideDutyRequests).set({ approvalId: approval.id }).where(eq(outsideDutyRequests.id, request.id));
      await recordAudit(
        tx,
        {
          ...auditOf(employee, actor),
          action: "outside_duty.requested",
          entityType: "outside_duty",
          entityId: request.id,
          after: { dutyDate: input.dutyDate, start: input.startTime, end: input.endTime, location: input.location, approvalId: approval.id },
          reason: input.notes,
        },
        context,
      );
      return { requestId: request.id, approvalId: approval.id };
    });
  } catch (error) {
    if (path) await storage.remove([path]).catch(() => {});
    throw error;
  }
}

export async function cancelOutsideDuty(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(refInput, raw);
  const employee = await requireSelfEmployee(db, actor, "attendance.checkin");
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select({ id: outsideDutyRequests.id, approvalId: outsideDutyRequests.approvalId })
      .from(outsideDutyRequests)
      .where(and(eq(outsideDutyRequests.id, input.id), eq(outsideDutyRequests.employeeId, employee.id)))
      .limit(1);
    if (!request?.approvalId) throw notFound();
    const [cancelled] = await tx
      .update(approvals)
      .set({ status: "cancelled", decidedAt: sql`now()` })
      .where(and(eq(approvals.id, request.approvalId), eq(approvals.status, "pending")))
      .returning({ id: approvals.id });
    if (!cancelled) throw new AccessError("conflict", "Pengajuan sudah diputuskan dan tidak bisa dibatalkan.");
    await recordAudit(
      tx,
      { ...auditOf(employee, actor), action: "outside_duty.cancelled", entityType: "outside_duty", entityId: request.id },
      context,
    );
    return { cancelled: true };
  });
}

/** Keputusan tugas luar: attendance.approve_outside_duty, bukan pemohon sendiri. */
export async function decideOutsideDuty(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(decisionInput, raw);
  const approval = await loadApproval(db, actor, input.approvalId, "outside_duty");
  assertAt(actor, "attendance.approve_outside_duty", approval.outletId);
  assertNotRequester(actor, approval);

  return db.transaction(async (tx) => {
    await decide(tx, actor, approval.id, input);
    await recordAudit(
      tx,
      {
        companyId: approval.companyId,
        brandId: approval.brandId,
        outletId: approval.outletId,
        actorId: actor.id,
        action: input.approve ? "outside_duty.approved" : "outside_duty.rejected",
        entityType: "outside_duty",
        entityId: approval.referenceId,
        after: { approvalId: approval.id, requestedBy: approval.requestedBy },
        reason: input.note,
      },
      context,
    );
    return { approved: input.approve };
  });
}

async function loadApproval(
  db: DbExecutor,
  actor: CurrentUser,
  approvalId: string,
  type: "outside_duty" | "attendance_correction",
) {
  const [approval] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, approvalId), eq(approvals.companyId, actor.company.id), eq(approvals.type, type)))
    .limit(1);
  if (!approval) throw notFound();
  return approval;
}

function assertNotRequester(actor: CurrentUser, approval: { requestedBy: string }) {
  if (approval.requestedBy === actor.id) {
    throw new AccessError("forbidden", "Anda tidak bisa memutuskan pengajuan Anda sendiri.");
  }
}

/** Hanya satu keputusan yang menang (approval ganda / klik ganda gagal). */
async function decide(tx: DbExecutor, actor: CurrentUser, approvalId: string, input: { approve: boolean; note?: string }) {
  const [decided] = await tx
    .update(approvals)
    .set({
      status: input.approve ? "approved" : "rejected",
      decidedBy: actor.id,
      decisionNote: input.note || null,
      decidedAt: sql`clock_timestamp()`,
    })
    .where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")))
    .returning({ id: approvals.id });
  if (!decided) throw new AccessError("conflict", "Pengajuan ini sudah diputuskan.");
}

// --- Koreksi absensi manual ----------------------------------------------------------------------------

/** Waktu lokal outlet (YYYY-MM-DDTHH:MM) → timestamptz, plus validasi terhadap waktu DB. */
async function localTimes(db: DbExecutor, timezone: string, values: string[]) {
  const list = sql.join(
    values.map((value, index) => sql`(${index}::int, ${value}::timestamp)`),
    sql`, `,
  );
  const rows = (await db.execute(sql`
    select (extract(epoch from v.t at time zone ${timezone}) * 1000)::bigint::text as at_ms,
           (v.t at time zone ${timezone}) > now() as in_future,
           v.t::date::text as local_date
    from (values ${list}) as v(n, t)
    order by v.n
  `)) as unknown as { at_ms: string; in_future: boolean; local_date: string }[];
  return rows.map((r) => ({ at: new Date(Number(r.at_ms)), inFuture: r.in_future, localDate: r.local_date }));
}

export async function requestCorrection(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(correctionInput, raw);
  const employee = await requireSelfEmployee(db, actor, "attendance.checkin");

  let checkInAt: Date | null = null;
  let checkOutAt: Date;
  let businessDate: string;
  let attendanceId: string | null = null;
  if (input.kind === "missing_check_out") {
    const [session] = await db
      .select({
        id: attendances.id,
        checkInAt: attendances.checkInAt,
        businessDate: attendances.businessDate,
        checkOutAt: attendances.checkOutAt,
      })
      .from(attendances)
      .where(and(eq(attendances.id, input.attendanceId), eq(attendances.employeeId, employee.id)))
      .limit(1);
    if (!session) throw notFound();
    if (session.checkOutAt) throw new AccessError("conflict", "Sesi ini sudah memiliki jam pulang.");
    const [out] = await localTimes(db, employee.timezone, [input.checkOutAt]);
    if (out.inFuture) throw new AccessError("invalid", "Jam pulang tidak boleh di masa depan.");
    if (out.at <= session.checkInAt) throw new AccessError("invalid", "Jam pulang harus setelah jam masuk.");
    checkOutAt = out.at;
    businessDate = session.businessDate;
    attendanceId = session.id;
  } else {
    const [inn, out] = await localTimes(db, employee.timezone, [input.checkInAt, input.checkOutAt]);
    if (inn.inFuture || out.inFuture) throw new AccessError("invalid", "Waktu absensi tidak boleh di masa depan.");
    if (out.at.getTime() - inn.at.getTime() > 24 * 60 * 60 * 1000) {
      throw new AccessError("invalid", "Durasi satu sesi maksimal 24 jam.");
    }
    checkInAt = inn.at;
    checkOutAt = out.at;
    businessDate = inn.localDate;
  }

  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select({ id: attendanceCorrections.id })
      .from(attendanceCorrections)
      .innerJoin(approvals, eq(approvals.id, attendanceCorrections.approvalId))
      .where(
        and(
          eq(attendanceCorrections.employeeId, employee.id),
          eq(approvals.status, "pending"),
          attendanceId
            ? eq(attendanceCorrections.attendanceId, attendanceId)
            : and(eq(attendanceCorrections.kind, "missing_attendance"), eq(attendanceCorrections.businessDate, businessDate)),
        ),
      )
      .limit(1);
    if (pending) throw new AccessError("conflict", "Koreksi serupa masih menunggu persetujuan.");

    const [correction] = await tx
      .insert(attendanceCorrections)
      .values({
        companyId: employee.companyId,
        brandId: employee.brandId,
        outletId: employee.outletId,
        employeeId: employee.id,
        kind: input.kind,
        businessDate,
        attendanceId,
        requestedCheckInAt: checkInAt,
        requestedCheckOutAt: checkOutAt,
        reason: input.reason,
        createdBy: actor.id,
      })
      .returning({ id: attendanceCorrections.id });
    const [approval] = await tx
      .insert(approvals)
      .values({
        companyId: employee.companyId,
        brandId: employee.brandId,
        outletId: employee.outletId,
        type: "attendance_correction",
        referenceId: correction.id,
        reason: input.reason,
        requestedBy: actor.id,
      })
      .returning({ id: approvals.id });
    await tx.update(attendanceCorrections).set({ approvalId: approval.id }).where(eq(attendanceCorrections.id, correction.id));
    await recordAudit(
      tx,
      {
        ...auditOf(employee, actor),
        action: "attendance.correction_requested",
        entityType: "attendance_correction",
        entityId: correction.id,
        after: { kind: input.kind, businessDate, checkInAt, checkOutAt, attendanceId, approvalId: approval.id },
        reason: input.reason,
      },
      context,
    );
    return { correctionId: correction.id, approvalId: approval.id };
  });
}

export async function cancelCorrection(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(refInput, raw);
  const employee = await requireSelfEmployee(db, actor, "attendance.checkin");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: attendanceCorrections.id, approvalId: attendanceCorrections.approvalId })
      .from(attendanceCorrections)
      .where(and(eq(attendanceCorrections.id, input.id), eq(attendanceCorrections.employeeId, employee.id)))
      .limit(1);
    if (!row?.approvalId) throw notFound();
    const [cancelled] = await tx
      .update(approvals)
      .set({ status: "cancelled", decidedAt: sql`now()` })
      .where(and(eq(approvals.id, row.approvalId), eq(approvals.status, "pending")))
      .returning({ id: approvals.id });
    if (!cancelled) throw new AccessError("conflict", "Koreksi sudah diputuskan dan tidak bisa dibatalkan.");
    await recordAudit(
      tx,
      { ...auditOf(employee, actor), action: "attendance.correction_cancelled", entityType: "attendance_correction", entityId: row.id },
      context,
    );
    return { cancelled: true };
  });
}

/**
 * Keputusan koreksi (approval.approve/reject di outlet, bukan pemohon).
 * Hasilnya berlabel manual_correction — tidak pernah biometrik.
 */
export async function decideCorrection(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(decisionInput, raw);
  const approval = await loadApproval(db, actor, input.approvalId, "attendance_correction");
  assertAt(actor, input.approve ? "approval.approve" : "approval.reject", approval.outletId);
  assertNotRequester(actor, approval);

  return db.transaction(async (tx) => {
    await decide(tx, actor, approval.id, input);
    const [correction] = await tx
      .select()
      .from(attendanceCorrections)
      .where(eq(attendanceCorrections.id, approval.referenceId))
      .for("update");
    if (!correction) throw notFound();
    const base: Omit<AuditEntry, "action"> = {
      companyId: approval.companyId,
      brandId: approval.brandId,
      outletId: approval.outletId,
      actorId: actor.id,
      entityType: "attendance_correction",
      entityId: correction.id,
      reason: input.note,
    };
    if (!input.approve) {
      await recordAudit(tx, { ...base, action: "attendance.correction_rejected", after: { approvalId: approval.id } }, context);
      return { approved: false, attendanceId: null };
    }

    const settings = await loadSettings(tx, approval.companyId);
    const outAt = correction.requestedCheckOutAt.toISOString();
    const inAt = correction.requestedCheckInAt?.toISOString() ?? null;
    let attendanceId: string;
    if (correction.kind === "missing_check_out") {
      const [row] = await tx
        .update(attendances)
        .set({
          status: "checked_out",
          checkOutAt: correction.requestedCheckOutAt,
          checkOutMethod: "manual_correction",
          workingMinutes: sql`floor(extract(epoch from (${outAt}::timestamptz - ${attendances.checkInAt})) / 60)::int`,
        })
        .where(
          and(
            eq(attendances.id, correction.attendanceId!),
            isNull(attendances.checkOutAt),
            sql`${attendances.checkInAt} < ${outAt}::timestamptz`,
          ),
        )
        .returning({ id: attendances.id });
      if (!row) throw new AccessError("conflict", "Sesi sudah ditutup atau jam pulang tidak valid.");
      attendanceId = row.id;
    } else {
      // Tidak boleh tumpang tindih dengan sesi lain milik karyawan (sesi terbuka = sampai tak hingga).
      const [overlap] = await tx
        .select({ id: attendances.id })
        .from(attendances)
        .where(
          and(
            eq(attendances.employeeId, correction.employeeId),
            sql`${attendances.checkInAt} < ${outAt}::timestamptz`,
            sql`coalesce(${attendances.checkOutAt}, 'infinity'::timestamptz) > ${inAt}::timestamptz`,
          ),
        )
        .limit(1);
      if (overlap) throw new AccessError("conflict", "Waktu koreksi bertumpuk dengan absensi lain.");
      const [row] = await tx
        .insert(attendances)
        .values({
          companyId: correction.companyId,
          brandId: correction.brandId,
          outletId: correction.outletId,
          employeeId: correction.employeeId,
          businessDate: correction.businessDate,
          status: "checked_out",
          policyVersion: settings.policyVersion,
          checkInAt: correction.requestedCheckInAt!,
          checkInMethod: "manual_correction",
          checkOutAt: correction.requestedCheckOutAt,
          checkOutMethod: "manual_correction",
          workingMinutes: sql`floor(extract(epoch from (${outAt}::timestamptz - ${inAt}::timestamptz)) / 60)::int`,
        })
        .returning({ id: attendances.id });
      attendanceId = row.id;
      await tx.update(attendanceCorrections).set({ attendanceId }).where(eq(attendanceCorrections.id, correction.id));
    }
    await recordAudit(
      tx,
      {
        ...base,
        action: "attendance.correction_approved",
        after: { approvalId: approval.id, attendanceId, kind: correction.kind, method: "manual_correction" },
      },
      context,
    );
    return { approved: true, attendanceId };
  });
}

// --- Pengaturan geofence & parameter --------------------------------------------------------------

/** Koordinat & radius outlet — hanya pemegang settings.manage company-wide (Super Admin). */
export async function updateOutletGeofence(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(outletGeofenceInput, raw);
  assertAt(actor, "settings.manage", null);
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: outlets.id,
        brandId: outlets.brandId,
        latitude: outlets.latitude,
        longitude: outlets.longitude,
        radiusMeter: outlets.attendanceRadiusMeter,
      })
      .from(outlets)
      .where(and(eq(outlets.id, input.outletId), eq(outlets.companyId, actor.company.id)))
      .for("update");
    if (!before) throw notFound();
    await tx
      .update(outlets)
      .set({ latitude: input.latitude, longitude: input.longitude, attendanceRadiusMeter: input.radiusMeter })
      .where(eq(outlets.id, before.id));
    await recordAudit(
      tx,
      {
        companyId: actor.company.id,
        brandId: before.brandId,
        outletId: before.id,
        actorId: actor.id,
        action: "attendance.geofence_changed",
        entityType: "outlet",
        entityId: before.id,
        before: { latitude: before.latitude, longitude: before.longitude, radiusMeter: before.radiusMeter },
        after: { latitude: input.latitude, longitude: input.longitude, radiusMeter: input.radiusMeter },
      },
      context,
    );
    return { outletId: before.id };
  });
}

export async function updateAttendanceSettings(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(attendanceSettingsInput, raw);
  assertAt(actor, "settings.manage", null);
  return db.transaction(async (tx) => {
    const before = await loadSettings(tx, actor.company.id);
    await tx
      .insert(attendanceSettings)
      .values({ companyId: actor.company.id, ...input, updatedBy: actor.id })
      .onConflictDoUpdate({ target: attendanceSettings.companyId, set: { ...input, updatedBy: actor.id } });
    await recordAudit(
      tx,
      {
        companyId: actor.company.id,
        actorId: actor.id,
        action: "attendance.settings_changed",
        entityType: "attendance_settings",
        before,
        after: input,
      },
      context,
    );
    return { saved: true };
  });
}
