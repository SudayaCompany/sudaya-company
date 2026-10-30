import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  approvals,
  attendances,
  biometricConsents,
  faceEnrollments,
  faceVerificationSessions,
  outlets,
} from "@/db/schema";
import { createEmployee, getEmployee, listEmployees, updateEmployee } from "@/lib/attendance/employees";
import {
  checkIn,
  checkLocation,
  checkOut,
  completeEnrollment,
  decideCorrection,
  decideOutsideDuty,
  getStaffAttendanceState,
  giveBiometricConsent,
  requestCorrection,
  requestOutsideDuty,
  revokeEnrollment,
  startFaceSession,
  updateAttendanceSettings,
  updateOutletGeofence,
} from "@/lib/attendance/engine";
import type { FaceVerificationProvider } from "@/lib/attendance/face-provider";
import { BIOMETRIC_NOTICE_VERSION } from "@/lib/attendance/privacy";
import { attendanceDashboard, attendanceReport, getOwnHistory } from "@/lib/attendance/queries";
import { AccessError } from "@/lib/auth/errors";
import { businessDateIn } from "@/lib/orders/dates";

import { createLiveContext, hasLiveEnv, type LiveContext, type TestCompany, type TestUser } from "../helpers/live";

const audit = { ip: "127.0.0.1", userAgent: "vitest" };
const noStorage = { upload: async () => {}, remove: async () => {}, signedUrl: async () => "" };
const OUTLET = { latitude: -6.2, longitude: 106.816666 };

async function expectAccessError(promise: Promise<unknown>, code: AccessError["code"], message?: RegExp) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error, "harus AccessError").toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
  if (message) expect((error as AccessError).message).toMatch(message);
}

/**
 * Provider PALSU — hanya untuk test terisolasi ini, disuntikkan langsung ke
 * engine (aplikasi tidak punya mode mock). Tidak ada data biometrik.
 */
function fakeProvider(id = "test-provider") {
  const behavior = { liveness: 95, match: 97, status: "succeeded" as "succeeded" | "failed" };
  const revoked: string[] = [];
  const provider: FaceVerificationProvider = {
    id,
    async createSession({ purpose, employeeRef }) {
      return { providerSessionId: `${purpose}:${employeeRef}:${randomUUID()}`, expiresAt: new Date(Date.now() + 5 * 60_000), client: {} };
    },
    async completeEnrollment({ employeeRef }) {
      return { status: behavior.status, livenessScore: behavior.liveness, subjectRef: `subject:${employeeRef}` };
    },
    async verify() {
      return { status: behavior.status, livenessScore: behavior.liveness, matchScore: behavior.match };
    },
    async revokeEnrollment({ subjectRef }) {
      revoked.push(subjectRef);
    },
  };
  return { provider, behavior, revoked };
}

/** Posisi n meter ke utara dari outlet. */
const near = (meters = 2, accuracy = 4) => ({
  latitude: OUTLET.latitude + meters / 111_320,
  longitude: OUTLET.longitude,
  accuracy,
  ageMs: 1000,
});

describe.skipIf(!hasLiveEnv)("absensi, verifikasi wajah, geofence (DB live)", () => {
  let ctx: LiveContext;
  let A: TestCompany;
  let B: TestCompany;
  let superA: TestUser;
  let managerA: TestUser;
  let manager2A: TestUser;
  let baristaA: TestUser;
  let barista2A: TestUser;
  let cashierA: TestUser;
  let superB: TestUser;
  let outlet2Id: string;
  const employeeOf = new Map<string, string>();
  const fake = fakeProvider();
  const P = fake.provider;

  const link = async (user: TestUser, code: string, outletId = A.outletId) => {
    const created = await createEmployee(
      ctx.db,
      superA.current,
      { employeeCode: `${code}-${ctx.runId}`, fullName: user.fullName, outletId, userId: user.id, position: "Barista" },
      audit,
    );
    employeeOf.set(user.id, created!.id);
    return created!.id;
  };
  const enroll = async (user: TestUser) => {
    await giveBiometricConsent(ctx.db, user.current, { noticeVersion: BIOMETRIC_NOTICE_VERSION, agree: true }, P, audit);
    const session = await startFaceSession(ctx.db, user.current, { purpose: "enrollment" }, P);
    await completeEnrollment(ctx.db, user.current, { sessionId: session.sessionId }, P, audit);
  };
  const session = (user: TestUser, purpose: "check_in" | "check_out") =>
    startFaceSession(ctx.db, user.current, { purpose }, P).then((s) => s.sessionId);
  const doCheckIn = async (user: TestUser, position: object = near()) =>
    checkIn(ctx.db, user.current, { sessionId: await session(user, "check_in"), position }, P, audit);
  const doCheckOut = async (user: TestUser, position: object = near()) =>
    checkOut(ctx.db, user.current, { sessionId: await session(user, "check_out"), position }, P, audit);

  beforeAll(async () => {
    ctx = createLiveContext();
    A = await ctx.createCompany("atta");
    B = await ctx.createCompany("attb");
    superA = await ctx.createUser(A, [{ role: "super_admin" }]);
    managerA = await ctx.createUser(A, [{ role: "manager", outlet: "outlet" }]);
    manager2A = await ctx.createUser(A, [{ role: "manager", outlet: "outlet" }]);
    baristaA = await ctx.createUser(A, [{ role: "barista", outlet: "outlet" }]);
    barista2A = await ctx.createUser(A, [{ role: "barista", outlet: "outlet" }]);
    cashierA = await ctx.createUser(A, [{ role: "cashier", outlet: "outlet" }]);
    superB = await ctx.createUser(B, [{ role: "super_admin" }]);

    await updateOutletGeofence(ctx.db, superA.current, { outletId: A.outletId, ...OUTLET, radiusMeter: 5 }, audit);
    await updateAttendanceSettings(
      ctx.db,
      superA.current,
      { maxGpsAccuracyMeter: 20, faceMatchThreshold: 90, livenessThreshold: 90, verificationProvider: P.id, policyVersion: "test" },
      audit,
    );
    const [o2] = await ctx.db
      .insert(outlets)
      .values({ companyId: A.id, brandId: A.brandId, code: `T${ctx.runId}ATT2`.toUpperCase(), name: "Outlet tanpa koordinat" })
      .returning({ id: outlets.id });
    outlet2Id = o2.id;
    for (const [user, code] of [[managerA, "MGR"], [manager2A, "MGR2"], [baristaA, "BAR"], [barista2A, "BAR2"], [cashierA, "CSH"]] as const) {
      await link(user, code);
    }
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });

  describe("karyawan & registrasi wajah", () => {
    it("data karyawan: Employee ID unik, akun hanya tertaut ke satu karyawan, izin per outlet", async () => {
      await expectAccessError(
        createEmployee(ctx.db, superA.current, { employeeCode: `bar-${ctx.runId}`, fullName: "Duplikat", outletId: A.outletId }, audit),
        "conflict",
        /Employee ID/,
      );
      await expectAccessError(
        createEmployee(ctx.db, superA.current, { employeeCode: `X-${ctx.runId}`, fullName: "Dobel akun", outletId: A.outletId, userId: baristaA.id }, audit),
        "conflict",
        /sudah ditautkan/,
      );
      await expectAccessError(
        createEmployee(ctx.db, baristaA.current, { employeeCode: `Y-${ctx.runId}`, fullName: "Tanpa izin", outletId: A.outletId }, audit),
        "forbidden",
      );
      // Manager outlet tidak bisa membuat karyawan di outlet lain.
      await expectAccessError(
        createEmployee(ctx.db, managerA.current, { employeeCode: `Z-${ctx.runId}`, fullName: "Outlet lain", outletId: outlet2Id }, audit),
        "forbidden",
      );
      await expectAccessError(listEmployees(ctx.db, superB.current, { status: "all", outlet: A.outletId }), "forbidden");
      const detail = await getEmployee(ctx.db, managerA.current, employeeOf.get(baristaA.id)!);
      expect(detail.employee).toMatchObject({ employeeCode: `BAR-${ctx.runId}`.toUpperCase(), isActive: true });
      expect(detail.employee).not.toHaveProperty("password");
      expect(await ctx.countAudit(A.id, "employee.created")).toBeGreaterThanOrEqual(5);
    });

    it("provider belum dikonfigurasi → tidak ada jalur biometrik yang bisa berhasil", async () => {
      await expectAccessError(giveBiometricConsent(ctx.db, baristaA.current, { noticeVersion: BIOMETRIC_NOTICE_VERSION, agree: true }, null, audit), "conflict", /belum dikonfigurasi/);
      await expectAccessError(startFaceSession(ctx.db, baristaA.current, { purpose: "check_in" }, null), "conflict", /belum dikonfigurasi/);
      await expectAccessError(checkIn(ctx.db, baristaA.current, { sessionId: randomUUID(), position: near() }, null, audit), "conflict", /belum dikonfigurasi/);
      // Provider lain dari yang disetujui juga dianggap belum dikonfigurasi.
      await expectAccessError(startFaceSession(ctx.db, baristaA.current, { purpose: "check_in" }, fakeProvider("lain").provider), "conflict", /belum dikonfigurasi/);
      const state = await getStaffAttendanceState(ctx.db, baristaA.current, null);
      expect(state.providerState).toMatchObject({ ready: false, reason: "provider_unconfigured" });
    });

    it("1. enrollment karyawan aktif: consent dicatat, hanya referensi provider yang disimpan", async () => {
      await expectAccessError(startFaceSession(ctx.db, baristaA.current, { purpose: "enrollment" }, P), "forbidden", /persetujuan/);
      await expectAccessError(giveBiometricConsent(ctx.db, baristaA.current, { noticeVersion: "lama", agree: true }, P, audit), "conflict");
      await enroll(baristaA);
      const [enrollment] = await ctx.db.select().from(faceEnrollments).where(eq(faceEnrollments.employeeId, employeeOf.get(baristaA.id)!));
      expect(enrollment).toMatchObject({ provider: P.id, externalFaceId: `subject:${employeeOf.get(baristaA.id)}`, revokedAt: null });
      expect(enrollment.consentId).toBeTruthy();
      expect(Object.keys(enrollment).some((k) => /photo|embedding|image|template/i.test(k))).toBe(false);
      await expectAccessError(startFaceSession(ctx.db, baristaA.current, { purpose: "enrollment" }, P), "conflict", /sudah terdaftar/);
      for (const user of [managerA, manager2A, barista2A, cashierA]) await enroll(user);
      expect(await ctx.countAudit(A.id, "biometric.consent_given", employeeOf.get(baristaA.id))).toBe(1);
      expect(await ctx.countAudit(A.id, "biometric.enrollment_created", employeeOf.get(baristaA.id))).toBe(1);
    });

    it("liveness gagal saat registrasi ditolak", async () => {
      const user = await ctx.createUser(A, [{ role: "barista", outlet: "outlet" }]);
      await link(user, "LIVE");
      await giveBiometricConsent(ctx.db, user.current, { noticeVersion: BIOMETRIC_NOTICE_VERSION, agree: true }, P, audit);
      fake.behavior.liveness = 40;
      const s = await startFaceSession(ctx.db, user.current, { purpose: "enrollment" }, P);
      await expectAccessError(completeEnrollment(ctx.db, user.current, { sessionId: s.sessionId }, P, audit), "invalid", /tidak dapat diverifikasi/);
      fake.behavior.liveness = 95;
      const enrolled = await ctx.db.select().from(faceEnrollments).where(eq(faceEnrollments.employeeId, employeeOf.get(user.id)!));
      expect(enrolled).toHaveLength(0);
    });
  });

  describe("check-in / check-out", () => {
    it("2. karyawan nonaktif / akun nonaktif ditolak", async () => {
      const user = await ctx.createUser(A, [{ role: "barista", outlet: "outlet" }]);
      const employeeId = await link(user, "OFF");
      await enroll(user);
      await updateEmployee(
        ctx.db,
        superA.current,
        { employeeId, fullName: user.fullName, outletId: A.outletId, userId: user.id, isActive: false },
        P,
        audit,
      );
      await expectAccessError(startFaceSession(ctx.db, user.current, { purpose: "check_in" }, P), "forbidden", /nonaktif/);
      // Nonaktif → registrasi wajah dicabut & dihapus di provider (retensi).
      const [enrollment] = await ctx.db.select().from(faceEnrollments).where(eq(faceEnrollments.employeeId, employeeId));
      expect(enrollment.revokedAt).not.toBeNull();
      expect(enrollment.providerDeletedAt).not.toBeNull();
      expect(fake.revoked).toContain(`subject:${employeeId}`);
      await expectAccessError(startFaceSession(ctx.db, { ...baristaA.current, isActive: false }, { purpose: "check_in" }, P), "forbidden");
    });

    it("3. wajah belum terdaftar ditolak", async () => {
      const user = await ctx.createUser(A, [{ role: "barista", outlet: "outlet" }]);
      await link(user, "NOFACE");
      await expectAccessError(startFaceSession(ctx.db, user.current, { purpose: "check_in" }, P), "forbidden", /belum terdaftar/);
      // Akun tanpa data karyawan juga ditolak.
      const orphan = await ctx.createUser(A, [{ role: "barista", outlet: "outlet" }]);
      await expectAccessError(startFaceSession(ctx.db, orphan.current, { purpose: "check_in" }, P), "forbidden", /belum terhubung/);
    });

    it("4–5. liveness gagal / wajah tidak cocok ditolak, tercatat proporsional", async () => {
      fake.behavior.liveness = 50;
      await expectAccessError(doCheckIn(baristaA), "invalid", /Wajah tidak dapat diverifikasi/);
      fake.behavior.liveness = 95;
      fake.behavior.match = 60;
      await expectAccessError(doCheckIn(baristaA), "invalid", /Wajah tidak dikenali/);
      fake.behavior.match = 97;
      const rows = await ctx.db.select().from(attendances).where(eq(attendances.employeeId, employeeOf.get(baristaA.id)!));
      expect(rows).toHaveLength(0);
      const failed = await ctx.db
        .select()
        .from(faceVerificationSessions)
        .where(and(eq(faceVerificationSessions.employeeId, employeeOf.get(baristaA.id)!), eq(faceVerificationSessions.status, "failed")));
      expect(failed.map((f) => f.failureReason).sort()).toEqual(["face_mismatch", "liveness_failed"]);
      expect(await ctx.countAudit(A.id, "attendance.verification_failed", employeeOf.get(baristaA.id))).toBe(2);
    });

    it("6–9. GPS: tidak aktif, di luar 5 m, akurasi buruk, cache lama, outlet tanpa koordinat", async () => {
      await expectAccessError(checkIn(ctx.db, baristaA.current, { sessionId: await session(baristaA, "check_in") }, P, audit), "invalid", /GPS wajib/);
      await expectAccessError(doCheckIn(baristaA, near(9)), "invalid", /luar area absensi/);
      await expectAccessError(doCheckIn(baristaA, near(2, 45)), "invalid", /Akurasi GPS/);
      await expectAccessError(doCheckIn(baristaA, { ...near(1), ageMs: 10 * 60_000 }), "invalid", /cache/);
      // Pratinjau memakai perhitungan server yang sama.
      const preview = await checkLocation(ctx.db, baristaA.current, { position: near(7) });
      expect(preview).toMatchObject({ ok: false, reason: "outside_radius", radiusMeter: 5 });
      expect(preview.distanceMeter).toBeCloseTo(7, 0);

      // Karyawan outlet 2 (outlet tanpa koordinat); akun berizin company-wide.
      const other = await ctx.createUser(A, [{ role: "super_admin" }]);
      await link(other, "NOCOORD2", outlet2Id);
      await enroll(other);
      await expectAccessError(doCheckIn(other), "invalid", /Koordinat outlet belum diatur/);
      expect(await ctx.countAudit(A.id, "attendance.location_rejected", employeeOf.get(baristaA.id))).toBe(3);
    });

    it("10–13. check-in/out sukses, duplikat & bersamaan aman, jam kerja dari waktu DB", async () => {
      const row = await doCheckIn(baristaA, near(3));
      await expectAccessError(doCheckIn(baristaA), "conflict", /masih tercatat check-in/);
      const [att] = await ctx.db.select().from(attendances).where(eq(attendances.id, row!.id));
      expect(att).toMatchObject({ checkInMethod: "biometric", status: "checked_in", checkOutAt: null, checkInIp: "127.0.0.1" });
      expect(att.checkInDistanceMeter).toBeCloseTo(3, 0);
      expect(att.checkInFaceScore).toBe(97);
      expect(att.businessDate).toBe(businessDateIn("Asia/Jakarta"));

      // Sesi verifikasi tidak bisa dipakai ulang / oleh karyawan lain.
      const [usedSession] = await ctx.db.select().from(faceVerificationSessions).where(eq(faceVerificationSessions.id, att.checkInVerificationId!));
      expect(usedSession.status).toBe("consumed");
      await expectAccessError(checkOut(ctx.db, baristaA.current, { sessionId: usedSession.id, position: near() }, P, audit), "forbidden");
      const foreign = await session(barista2A, "check_out");
      await expectAccessError(checkOut(ctx.db, baristaA.current, { sessionId: foreign, position: near() }, P, audit), "forbidden");

      // Jam masuk dimundurkan 125 menit (manipulasi test) → durasi dari timestamp DB.
      await ctx.db.update(attendances).set({ checkInAt: sql`now() - interval '125 minutes'` }).where(eq(attendances.id, row!.id));
      const [s1, s2] = await Promise.all([session(baristaA, "check_out"), session(baristaA, "check_out")]);
      const results = await Promise.allSettled([
        checkOut(ctx.db, baristaA.current, { sessionId: s1, position: near() }, P, audit),
        checkOut(ctx.db, baristaA.current, { sessionId: s2, position: near() }, P, audit),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const [closed] = await ctx.db.select().from(attendances).where(eq(attendances.id, row!.id));
      expect(closed).toMatchObject({ status: "checked_out", checkOutMethod: "biometric", workingMinutes: 125 });
      await expectAccessError(doCheckOut(baristaA), "conflict", /Tidak ada sesi/);

      // Check-in bersamaan → satu sesi terbuka saja.
      const [c1, c2] = await Promise.all([session(barista2A, "check_in"), session(barista2A, "check_in")]);
      const concurrent = await Promise.allSettled([
        checkIn(ctx.db, barista2A.current, { sessionId: c1, position: near() }, P, audit),
        checkIn(ctx.db, barista2A.current, { sessionId: c2, position: near() }, P, audit),
      ]);
      expect(concurrent.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const open = await ctx.db.select().from(attendances).where(and(eq(attendances.employeeId, employeeOf.get(barista2A.id)!), sql`${attendances.checkOutAt} is null`));
      expect(open).toHaveLength(1);
      expect(await ctx.countAudit(A.id, "attendance.check_in", row!.id)).toBe(1);
      expect(await ctx.countAudit(A.id, "attendance.check_out", row!.id)).toBe(1);
    });
  });

  describe("tugas luar & koreksi manual", () => {
    const today = () => businessDateIn("Asia/Jakarta");
    const far = { latitude: -6.25, longitude: 106.9, accuracy: 8, ageMs: 500 };

    it("14–15. tugas luar butuh approval berwenang; pemohon tidak bisa menyetujui sendiri", async () => {
      const req = await requestOutsideDuty(
        ctx.db,
        cashierA.current,
        { dutyDate: today(), startTime: "00:00", endTime: "23:59", location: "Kantor pusat", purpose: "Rapat stok", notes: "Dipanggil manajemen" },
        null,
        noStorage,
        audit,
      );
      // Belum disetujui → geofence outlet tetap berlaku.
      await expectAccessError(doCheckIn(cashierA, far), "invalid", /luar area absensi/);
      await expectAccessError(decideOutsideDuty(ctx.db, baristaA.current, { approvalId: req.approvalId, approve: true }, audit), "forbidden");
      await decideOutsideDuty(ctx.db, managerA.current, { approvalId: req.approvalId, approve: true }, audit);
      await expectAccessError(decideOutsideDuty(ctx.db, manager2A.current, { approvalId: req.approvalId, approve: false }, audit), "conflict");
      const row = await doCheckIn(cashierA, far);
      const [att] = await ctx.db.select().from(attendances).where(eq(attendances.id, row!.id));
      expect(att.outsideDutyRequestId).toBe(req.requestId);
      expect(att.checkInMethod).toBe("biometric"); // wajah tetap diverifikasi
      expect(att.checkInDistanceMeter).toBeGreaterThan(5);
      await doCheckOut(cashierA, far);

      const own = await requestOutsideDuty(
        ctx.db,
        managerA.current,
        { dutyDate: today(), startTime: "00:00", endTime: "23:59", location: "Supplier", purpose: "Cek bahan", notes: "Kunjungan supplier" },
        null,
        noStorage,
        audit,
      );
      await expectAccessError(decideOutsideDuty(ctx.db, managerA.current, { approvalId: own.approvalId, approve: true }, audit), "forbidden", /sendiri/);
      await expectAccessError(
        requestOutsideDuty(ctx.db, managerA.current, { dutyDate: today(), startTime: "10:00", endTime: "11:00", location: "Lain", purpose: "Bentrok", notes: "Jadwal bentrok" }, null, noStorage, audit),
        "conflict",
        /Sudah ada pengajuan/,
      );
      expect(await ctx.countAudit(A.id, "outside_duty.requested")).toBe(2);
      expect(await ctx.countAudit(A.id, "outside_duty.approved", req.requestId)).toBe(1);
    });

    it("18. koreksi manual butuh approval dan tidak pernah berlabel biometrik", async () => {
      const day = new Date(Date.now() - 3 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
      const req = await requestCorrection(
        ctx.db,
        managerA.current,
        { kind: "missing_attendance", checkInAt: `${day}T08:00`, checkOutAt: `${day}T16:30`, reason: "Layanan verifikasi belum tersedia" },
        audit,
      );
      await expectAccessError(decideCorrection(ctx.db, managerA.current, { approvalId: req.approvalId, approve: true }, audit), "forbidden", /sendiri/);
      await expectAccessError(decideCorrection(ctx.db, baristaA.current, { approvalId: req.approvalId, approve: true }, audit), "forbidden");
      const decided = await decideCorrection(ctx.db, manager2A.current, { approvalId: req.approvalId, approve: true }, audit);
      const [att] = await ctx.db.select().from(attendances).where(eq(attendances.id, decided.attendanceId!));
      expect(att).toMatchObject({
        checkInMethod: "manual_correction",
        checkOutMethod: "manual_correction",
        checkInLatitude: null,
        checkInFaceScore: null,
        workingMinutes: 510,
        businessDate: day,
      });
      // Tumpang tindih dengan sesi yang sudah ada ditolak saat approval.
      const overlap = await requestCorrection(
        ctx.db,
        managerA.current,
        { kind: "missing_attendance", checkInAt: `${day}T15:00`, checkOutAt: `${day}T18:00`, reason: "Duplikat jam kerja" },
        audit,
      );
      await expectAccessError(decideCorrection(ctx.db, manager2A.current, { approvalId: overlap.approvalId, approve: true }, audit), "conflict", /bertumpuk/);
      await expectAccessError(
        requestCorrection(ctx.db, managerA.current, { kind: "missing_attendance", checkInAt: "2999-01-01T08:00", checkOutAt: "2999-01-01T09:00", reason: "Masa depan" }, audit),
        "invalid",
        /masa depan/,
      );

      // Lupa check-out: sesi terbuka barista2A ditutup lewat koreksi.
      const [open] = await ctx.db.select().from(attendances).where(and(eq(attendances.employeeId, employeeOf.get(barista2A.id)!), sql`${attendances.checkOutAt} is null`));
      await ctx.db.update(attendances).set({ checkInAt: sql`now() - interval '3 hours'` }).where(eq(attendances.id, open.id));
      const nowLocal = new Date(Date.now() - 60 * 60_000).toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" }).slice(0, 16).replace(" ", "T");
      const fix = await requestCorrection(ctx.db, barista2A.current, { kind: "missing_check_out", attendanceId: open.id, checkOutAt: nowLocal, reason: "Lupa check-out" }, audit);
      await decideCorrection(ctx.db, managerA.current, { approvalId: fix.approvalId, approve: true }, audit);
      const [closed] = await ctx.db.select().from(attendances).where(eq(attendances.id, open.id));
      expect(closed).toMatchObject({ checkInMethod: "biometric", checkOutMethod: "manual_correction", status: "checked_out" });
      expect(closed.workingMinutes).toBeGreaterThanOrEqual(119);
      expect(closed.workingMinutes).toBeLessThanOrEqual(121);

      const report = await attendanceReport(ctx.db, managerA.current, { from: day, to: businessDateIn("Asia/Jakarta") });
      expect(report.rows.find((r) => r.id === decided.attendanceId)).toMatchObject({ category: "manual", method: "Koreksi manual" });
      expect(report.rows.find((r) => r.id === open.id)).toMatchObject({ category: "manual", method: "Masuk biometrik, pulang koreksi manual" });
      expect(report.counts.verified).toBeGreaterThanOrEqual(1);
      expect(report.counts.outside_duty).toBe(1);
      expect(await ctx.countAudit(A.id, "attendance.correction_approved")).toBe(2);
    });
  });

  describe("akses data & audit", () => {
    it("16. karyawan hanya melihat absensinya sendiri", async () => {
      const own = await getOwnHistory(ctx.db, baristaA.current, undefined);
      expect(own!.sessions.length).toBeGreaterThan(0);
      expect(own!.sessions.every((s) => s.employeeId === employeeOf.get(baristaA.id))).toBe(true);
      await expectAccessError(attendanceDashboard(ctx.db, baristaA.current, {}), "forbidden");
      await expectAccessError(attendanceReport(ctx.db, baristaA.current, {}), "forbidden");
      await expectAccessError(getEmployee(ctx.db, baristaA.current, employeeOf.get(managerA.id)!), "forbidden");
    });

    it("17. manager hanya melihat outlet yang diizinkan; company lain tidak terlihat", async () => {
      const board = await attendanceDashboard(ctx.db, managerA.current, {});
      expect(board.outlets.map((o) => o.id)).toEqual([A.outletId]);
      expect(board.summary.employees).toBeGreaterThan(0);
      expect(board.rows.some((r) => r.fullName === managerA.fullName)).toBe(true);
      await expectAccessError(attendanceDashboard(ctx.db, managerA.current, { outlet: outlet2Id }), "forbidden");
      await expectAccessError(attendanceDashboard(ctx.db, superB.current, { outlet: A.outletId }), "forbidden");
      const report = await attendanceReport(ctx.db, superB.current, {});
      expect(report.rows).toHaveLength(0);
      // Pengaturan geofence hanya Super Admin (settings.manage company-wide).
      await expectAccessError(updateOutletGeofence(ctx.db, managerA.current, { outletId: A.outletId, ...OUTLET, radiusMeter: 50 }, audit), "forbidden");
    });

    it("pencabutan oleh karyawan: persetujuan ditarik, template dihapus di provider", async () => {
      await revokeEnrollment(ctx.db, cashierA.current, { reason: "Menarik persetujuan" }, P, audit);
      const employeeId = employeeOf.get(cashierA.id)!;
      const [enrollment] = await ctx.db.select().from(faceEnrollments).where(eq(faceEnrollments.employeeId, employeeId));
      expect(enrollment.revokedAt).not.toBeNull();
      expect(enrollment.providerDeletedAt).not.toBeNull();
      const consents = await ctx.db.select().from(biometricConsents).where(eq(biometricConsents.employeeId, employeeId));
      expect(consents.every((c) => c.withdrawnAt !== null)).toBe(true);
      await expectAccessError(startFaceSession(ctx.db, cashierA.current, { purpose: "check_in" }, P), "forbidden", /belum terdaftar/);
    });

    it("19. perubahan kritis tercatat di audit log tanpa data biometrik", async () => {
      for (const action of [
        "attendance.geofence_changed",
        "attendance.settings_changed",
        "biometric.enrollment_created",
        "biometric.enrollment_revoked",
        "attendance.check_in",
        "attendance.check_out",
        "attendance.verification_failed",
        "outside_duty.requested",
        "outside_duty.approved",
        "attendance.correction_requested",
        "attendance.correction_approved",
        "employee.updated",
      ]) {
        expect(await ctx.countAudit(A.id, action), action).toBeGreaterThan(0);
      }
      const logs = await ctx.db.execute(sql`select coalesce(before::text, '') || coalesce(after::text, '') as data from audit_logs where company_id = ${A.id}`);
      const text = (logs as unknown as { data: string }[]).map((l) => l.data).join("\n");
      expect(text).not.toMatch(/subject:/); // referensi template provider tidak masuk audit
      const [pending] = await ctx.db.select().from(approvals).where(and(eq(approvals.companyId, A.id), eq(approvals.status, "pending")));
      expect(pending).toBeTruthy(); // pengajuan manager sendiri masih menunggu approver lain
    });
  });
});
