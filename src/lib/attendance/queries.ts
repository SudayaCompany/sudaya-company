// Query absensi: riwayat milik sendiri (staf), dashboard & laporan (admin),
// serta daftar pengajuan. Semua dari data sungguhan; "belum check-in" TIDAK
// disamakan dengan terlambat/tidak hadir karena belum ada jadwal shift resmi.

import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { DbExecutor } from "@/db/client";
import {
  approvals,
  attendanceCorrections,
  attendances,
  employees,
  outlets,
  outsideDutyRequests,
  users,
} from "@/db/schema";
import type { CurrentUser } from "@/lib/auth/access";
import { AccessError } from "@/lib/auth/errors";
import { hasPermission } from "@/lib/auth/policy";
import type { Permission } from "@/lib/auth/rbac";
import { businessDateIn } from "@/lib/orders/dates";
import { outletsWithPermission } from "@/lib/orders/engine";

import { findSelfEmployee } from "./engine";
import type { attendanceListParams } from "./schemas";

const forbidden = () => new AccessError("forbidden", "Anda tidak memiliki izin untuk tindakan ini.");
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

type ListParams = z.infer<typeof attendanceListParams>;

const sessionColumns = {
  id: attendances.id,
  employeeId: attendances.employeeId,
  outletId: attendances.outletId,
  businessDate: attendances.businessDate,
  status: attendances.status,
  checkInAt: attendances.checkInAt,
  checkOutAt: attendances.checkOutAt,
  workingMinutes: attendances.workingMinutes,
  checkInMethod: attendances.checkInMethod,
  checkOutMethod: attendances.checkOutMethod,
  checkInAccuracyMeter: attendances.checkInAccuracyMeter,
  checkInDistanceMeter: attendances.checkInDistanceMeter,
  outsideDutyRequestId: attendances.outsideDutyRequestId,
};

export type ReportCategory = "verified" | "manual" | "outside_duty" | "incomplete";

/** Pemisahan laporan: belum lengkap → koreksi manual → tugas luar → terverifikasi. */
export function categoryOf(row: {
  checkOutAt: Date | null;
  checkInMethod: string;
  checkOutMethod: string | null;
  outsideDutyRequestId: string | null;
}): ReportCategory {
  if (!row.checkOutAt) return "incomplete";
  if (row.checkInMethod === "manual_correction" || row.checkOutMethod === "manual_correction") return "manual";
  if (row.outsideDutyRequestId) return "outside_duty";
  return "verified";
}

export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  verified: "Terverifikasi biometrik",
  manual: "Koreksi manual (disetujui)",
  outside_duty: "Tugas luar disetujui",
  incomplete: "Belum lengkap",
};

export function methodLabel(checkIn: string, checkOut: string | null) {
  const label = (m: string | null) => (m === "biometric" ? "biometrik" : m === "manual_correction" ? "koreksi manual" : "—");
  if (!checkOut || checkIn === checkOut) return checkIn === "biometric" ? "Biometrik" : "Koreksi manual";
  return `Masuk ${label(checkIn)}, pulang ${label(checkOut)}`;
}

// --- Staf: data milik sendiri -------------------------------------------------------

export async function getOwnHistory(db: DbExecutor, actor: CurrentUser, month: string | undefined) {
  const employee = await findSelfEmployee(db, actor);
  if (!employee) return null;
  const current = businessDateIn(employee.timezone).slice(0, 7);
  const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : current;
  const from = `${ym}-01`;
  const to = sql`(${from}::date + interval '1 month')::date`;

  const outsideDuty = alias(outsideDutyRequests, "od");
  const [sessions, duties, corrections] = await Promise.all([
    db
      .select({ ...sessionColumns, outletName: outlets.name, outsideDutyLocation: outsideDuty.location })
      .from(attendances)
      .innerJoin(outlets, eq(outlets.id, attendances.outletId))
      .leftJoin(outsideDuty, eq(outsideDuty.id, attendances.outsideDutyRequestId))
      // Hanya milik karyawan yang tertaut ke akun ini.
      .where(and(eq(attendances.employeeId, employee.id), gte(attendances.businessDate, from), sql`${attendances.businessDate} < ${to}`))
      .orderBy(desc(attendances.checkInAt)),
    listOwnOutsideDuty(db, employee.id),
    db
      .select({
        id: attendanceCorrections.id,
        kind: attendanceCorrections.kind,
        businessDate: attendanceCorrections.businessDate,
        requestedCheckInAt: attendanceCorrections.requestedCheckInAt,
        requestedCheckOutAt: attendanceCorrections.requestedCheckOutAt,
        reason: attendanceCorrections.reason,
        status: approvals.status,
        decisionNote: approvals.decisionNote,
      })
      .from(attendanceCorrections)
      .innerJoin(approvals, eq(approvals.id, attendanceCorrections.approvalId))
      .where(eq(attendanceCorrections.employeeId, employee.id))
      .orderBy(desc(attendanceCorrections.createdAt))
      .limit(20),
  ]);
  return {
    employee,
    month: ym,
    sessions: sessions.map((s) => ({ ...s, category: categoryOf(s) })),
    totalMinutes: sessions.reduce((sum, s) => sum + (s.workingMinutes ?? 0), 0),
    duties,
    corrections,
  };
}

export async function listOwnOutsideDuty(db: DbExecutor, employeeId: string) {
  const decider = alias(users, "decider");
  return db
    .select({
      id: outsideDutyRequests.id,
      dutyDate: outsideDutyRequests.dutyDate,
      startsAt: outsideDutyRequests.startsAt,
      endsAt: outsideDutyRequests.endsAt,
      location: outsideDutyRequests.location,
      purpose: outsideDutyRequests.purpose,
      notes: outsideDutyRequests.notes,
      status: approvals.status,
      decisionNote: approvals.decisionNote,
      decidedByName: decider.fullName,
    })
    .from(outsideDutyRequests)
    .innerJoin(approvals, eq(approvals.id, outsideDutyRequests.approvalId))
    .leftJoin(decider, eq(decider.id, approvals.decidedBy))
    .where(eq(outsideDutyRequests.employeeId, employeeId))
    .orderBy(desc(outsideDutyRequests.dutyDate), desc(outsideDutyRequests.createdAt))
    .limit(30);
}

/** Sesi terbuka milik sendiri (untuk form koreksi jam pulang). */
export async function listOwnOpenSessions(db: DbExecutor, employeeId: string) {
  return db
    .select({ id: attendances.id, businessDate: attendances.businessDate, checkInAt: attendances.checkInAt })
    .from(attendances)
    .where(and(eq(attendances.employeeId, employeeId), isNull(attendances.checkOutAt)))
    .orderBy(desc(attendances.checkInAt));
}

// --- Admin -------------------------------------------------------------------------------------

async function scope(db: DbExecutor, actor: CurrentUser, permission: Permission, outlet?: string) {
  const allowed = await outletsWithPermission(db, actor, permission);
  if (allowed.length === 0) throw forbidden();
  const outletIds = outlet ? allowed.filter((o) => o.id === outlet).map((o) => o.id) : allowed.map((o) => o.id);
  if (outletIds.length === 0) throw forbidden();
  return { allowed, outletIds };
}

export type DashboardStatus = "working" | "checked_out" | "not_checked_in";

export async function attendanceDashboard(db: DbExecutor, actor: CurrentUser, params: ListParams) {
  const { allowed, outletIds } = await scope(db, actor, "attendance.view", params.outlet);
  const date = params.date ?? businessDateIn(allowed.find((o) => o.id === outletIds[0])!.timezone);

  const conditions: (SQL | undefined)[] = [
    eq(employees.companyId, actor.company.id),
    inArray(employees.outletId, outletIds),
    eq(employees.isActive, true),
  ];
  if (params.q) {
    const pattern = `%${escapeLike(params.q)}%`;
    conditions.push(or(ilike(employees.fullName, pattern), ilike(employees.employeeCode, pattern)));
  }
  const staff = await db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      fullName: employees.fullName,
      position: employees.position,
      outletName: outlets.name,
      timezone: outlets.timezone,
    })
    .from(employees)
    .innerJoin(outlets, eq(outlets.id, employees.outletId))
    .where(and(...conditions))
    .orderBy(asc(employees.fullName));
  const ids = staff.map((s) => s.id);

  const [sessions, duties] = ids.length
    ? await Promise.all([
        db
          .select(sessionColumns)
          .from(attendances)
          // Sesi hari tsb + sesi terbuka dari hari sebelumnya (lintas tengah malam).
          .where(and(inArray(attendances.employeeId, ids), or(eq(attendances.businessDate, date), isNull(attendances.checkOutAt))))
          .orderBy(asc(attendances.checkInAt)),
        db
          .select({ employeeId: outsideDutyRequests.employeeId, location: outsideDutyRequests.location, purpose: outsideDutyRequests.purpose })
          .from(outsideDutyRequests)
          .innerJoin(approvals, eq(approvals.id, outsideDutyRequests.approvalId))
          .where(and(inArray(outsideDutyRequests.employeeId, ids), eq(outsideDutyRequests.dutyDate, date), eq(approvals.status, "approved"))),
      ])
    : [[], []];

  const rows = staff.map((s) => {
    const own = sessions.filter((x) => x.employeeId === s.id);
    const open = own.find((x) => !x.checkOutAt) ?? null;
    const status: DashboardStatus = open ? "working" : own.length ? "checked_out" : "not_checked_in";
    const duty = duties.find((d) => d.employeeId === s.id) ?? null;
    return {
      ...s,
      status,
      firstCheckIn: own[0]?.checkInAt ?? null,
      lastCheckOut: open ? null : (own.at(-1)?.checkOutAt ?? null),
      workedMinutes: own.reduce((sum, x) => sum + (x.workingMinutes ?? 0), 0),
      sessions: own.length,
      manual: own.some((x) => x.checkInMethod === "manual_correction" || x.checkOutMethod === "manual_correction"),
      outsideDuty: duty,
    };
  });
  const summary = {
    employees: rows.length,
    checkedIn: rows.filter((r) => r.status !== "not_checked_in").length,
    notCheckedIn: rows.filter((r) => r.status === "not_checked_in").length,
    working: rows.filter((r) => r.status === "working").length,
    checkedOut: rows.filter((r) => r.status === "checked_out").length,
    outsideDuty: rows.filter((r) => r.outsideDuty).length,
  };
  const filtered = rows.filter((r) => {
    switch (params.status) {
      case "checked_in":
        return r.status !== "not_checked_in";
      case "working":
      case "checked_out":
      case "not_checked_in":
        return r.status === params.status;
      case "outside_duty":
        return Boolean(r.outsideDuty);
      default:
        return true;
    }
  });
  return { date, outlets: allowed, summary, rows: filtered };
}

const MAX_REPORT_DAYS = 92;

export async function attendanceReport(db: DbExecutor, actor: CurrentUser, params: ListParams) {
  const { allowed, outletIds } = await scope(db, actor, "report.attendance", params.outlet);
  const today = businessDateIn(allowed.find((o) => o.id === outletIds[0])!.timezone);
  const to = params.to && datePattern.test(params.to) ? params.to : today;
  const from = params.from && datePattern.test(params.from) ? params.from : `${to.slice(0, 8)}01`;
  if (from > to) throw new AccessError("invalid", "Tanggal awal harus sebelum tanggal akhir.");
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days > MAX_REPORT_DAYS) throw new AccessError("invalid", `Rentang laporan maksimal ${MAX_REPORT_DAYS} hari.`);

  const conditions: (SQL | undefined)[] = [
    eq(attendances.companyId, actor.company.id),
    inArray(attendances.outletId, outletIds),
    gte(attendances.businessDate, from),
    lte(attendances.businessDate, to),
  ];
  if (params.q) {
    const pattern = `%${escapeLike(params.q)}%`;
    conditions.push(or(ilike(employees.fullName, pattern), ilike(employees.employeeCode, pattern)));
  }
  const outsideDuty = alias(outsideDutyRequests, "od");
  const rows = await db
    .select({
      ...sessionColumns,
      employeeCode: employees.employeeCode,
      employeeName: employees.fullName,
      outletName: outlets.name,
      timezone: outlets.timezone,
      outsideDutyPurpose: outsideDuty.purpose,
      outsideDutyLocation: outsideDuty.location,
    })
    .from(attendances)
    .innerJoin(employees, eq(employees.id, attendances.employeeId))
    .innerJoin(outlets, eq(outlets.id, attendances.outletId))
    .leftJoin(outsideDuty, eq(outsideDuty.id, attendances.outsideDutyRequestId))
    .where(and(...conditions))
    .orderBy(asc(attendances.businessDate), asc(employees.fullName), asc(attendances.checkInAt))
    .limit(5000);

  const corrections = rows.length
    ? await db
        .select({ attendanceId: attendanceCorrections.attendanceId, reason: attendanceCorrections.reason })
        .from(attendanceCorrections)
        .innerJoin(approvals, eq(approvals.id, attendanceCorrections.approvalId))
        .where(and(inArray(attendanceCorrections.attendanceId, rows.map((r) => r.id)), eq(approvals.status, "approved")))
    : [];

  const all = rows.map((r) => {
    const category = categoryOf(r);
    const correction = corrections.find((c) => c.attendanceId === r.id);
    const notes = [
      r.outsideDutyPurpose ? `Tugas luar: ${r.outsideDutyPurpose} (${r.outsideDutyLocation})` : null,
      correction ? `Koreksi: ${correction.reason}` : null,
    ].filter(Boolean).join(" · ");
    return { ...r, category, method: methodLabel(r.checkInMethod, r.checkOutMethod), notes };
  });
  const counts = { verified: 0, manual: 0, outside_duty: 0, incomplete: 0 } satisfies Record<ReportCategory, number>;
  for (const r of all) counts[r.category]++;

  const approvedDuties = await db
    .select({
      id: outsideDutyRequests.id,
      dutyDate: outsideDutyRequests.dutyDate,
      startsAt: outsideDutyRequests.startsAt,
      endsAt: outsideDutyRequests.endsAt,
      location: outsideDutyRequests.location,
      purpose: outsideDutyRequests.purpose,
      employeeName: employees.fullName,
      timezone: outlets.timezone,
    })
    .from(outsideDutyRequests)
    .innerJoin(approvals, eq(approvals.id, outsideDutyRequests.approvalId))
    .innerJoin(employees, eq(employees.id, outsideDutyRequests.employeeId))
    .innerJoin(outlets, eq(outlets.id, outsideDutyRequests.outletId))
    .where(
      and(
        inArray(outsideDutyRequests.outletId, outletIds),
        eq(approvals.status, "approved"),
        gte(outsideDutyRequests.dutyDate, from),
        lte(outsideDutyRequests.dutyDate, to),
      ),
    )
    .orderBy(asc(outsideDutyRequests.dutyDate));

  return {
    from,
    to,
    outlets: allowed,
    counts,
    totalMinutes: all.reduce((sum, r) => sum + (r.workingMinutes ?? 0), 0),
    rows: params.category ? all.filter((r) => r.category === params.category) : all,
    approvedDuties,
  };
}
export type ReportRow = Awaited<ReturnType<typeof attendanceReport>>["rows"][number];

export async function listOutsideDutyRequests(
  db: DbExecutor,
  actor: CurrentUser,
  params: { status?: "pending" | "approved" | "rejected" | "cancelled"; outlet?: string },
) {
  const viewer = hasPermission(actor, "attendance.approve_outside_duty") ? "attendance.approve_outside_duty" : "attendance.view";
  const { allowed, outletIds } = await scope(db, actor, viewer, params.outlet);
  const requester = alias(users, "requester");
  const decider = alias(users, "decider");
  const rows = await db
    .select({
      id: outsideDutyRequests.id,
      outletId: outsideDutyRequests.outletId,
      dutyDate: outsideDutyRequests.dutyDate,
      startsAt: outsideDutyRequests.startsAt,
      endsAt: outsideDutyRequests.endsAt,
      location: outsideDutyRequests.location,
      purpose: outsideDutyRequests.purpose,
      notes: outsideDutyRequests.notes,
      hasEvidence: sql<boolean>`${outsideDutyRequests.evidencePath} is not null`,
      employeeName: employees.fullName,
      employeeCode: employees.employeeCode,
      outletName: outlets.name,
      timezone: outlets.timezone,
      approvalId: approvals.id,
      status: approvals.status,
      requestedBy: approvals.requestedBy,
      requestedByName: requester.fullName,
      decidedByName: decider.fullName,
      decisionNote: approvals.decisionNote,
      createdAt: outsideDutyRequests.createdAt,
    })
    .from(outsideDutyRequests)
    .innerJoin(approvals, eq(approvals.id, outsideDutyRequests.approvalId))
    .innerJoin(employees, eq(employees.id, outsideDutyRequests.employeeId))
    .innerJoin(outlets, eq(outlets.id, outsideDutyRequests.outletId))
    .innerJoin(requester, eq(requester.id, approvals.requestedBy))
    .leftJoin(decider, eq(decider.id, approvals.decidedBy))
    .where(
      and(
        eq(outsideDutyRequests.companyId, actor.company.id),
        inArray(outsideDutyRequests.outletId, outletIds),
        params.status ? eq(approvals.status, params.status) : undefined,
      ),
    )
    .orderBy(desc(outsideDutyRequests.createdAt))
    .limit(200);
  return {
    outlets: allowed,
    rows: rows.map((r) => ({
      ...r,
      canDecide:
        r.status === "pending" &&
        r.requestedBy !== actor.id &&
        hasPermission(actor, "attendance.approve_outside_duty", { outletId: r.outletId }),
    })),
  };
}
export type OutsideDutyRow = Awaited<ReturnType<typeof listOutsideDutyRequests>>["rows"][number];

export async function listPendingCorrections(db: DbExecutor, actor: CurrentUser, outlet?: string) {
  const { outletIds } = await scope(db, actor, "attendance.view", outlet);
  const requester = alias(users, "requester");
  const rows = await db
    .select({
      id: attendanceCorrections.id,
      outletId: attendanceCorrections.outletId,
      kind: attendanceCorrections.kind,
      businessDate: attendanceCorrections.businessDate,
      requestedCheckInAt: attendanceCorrections.requestedCheckInAt,
      requestedCheckOutAt: attendanceCorrections.requestedCheckOutAt,
      reason: attendanceCorrections.reason,
      employeeName: employees.fullName,
      timezone: outlets.timezone,
      approvalId: approvals.id,
      requestedBy: approvals.requestedBy,
      requestedByName: requester.fullName,
      createdAt: attendanceCorrections.createdAt,
    })
    .from(attendanceCorrections)
    .innerJoin(approvals, eq(approvals.id, attendanceCorrections.approvalId))
    .innerJoin(employees, eq(employees.id, attendanceCorrections.employeeId))
    .innerJoin(outlets, eq(outlets.id, attendanceCorrections.outletId))
    .innerJoin(requester, eq(requester.id, approvals.requestedBy))
    .where(
      and(
        eq(attendanceCorrections.companyId, actor.company.id),
        inArray(attendanceCorrections.outletId, outletIds),
        eq(approvals.status, "pending"),
      ),
    )
    .orderBy(asc(attendanceCorrections.createdAt));
  return rows.map((r) => ({
    ...r,
    canApprove: r.requestedBy !== actor.id && hasPermission(actor, "approval.approve", { outletId: r.outletId }),
    canReject: r.requestedBy !== actor.id && hasPermission(actor, "approval.reject", { outletId: r.outletId }),
  }));
}
export type PendingCorrection = Awaited<ReturnType<typeof listPendingCorrections>>[number];

/** Outlet + koordinat untuk halaman pengaturan geofence (Super Admin). */
export async function geofenceOutlets(db: DbExecutor, actor: CurrentUser) {
  if (!actor.isActive || !hasPermission(actor, "settings.manage", { outletId: null })) throw forbidden();
  return db
    .select({
      id: outlets.id,
      code: outlets.code,
      name: outlets.name,
      latitude: outlets.latitude,
      longitude: outlets.longitude,
      radiusMeter: outlets.attendanceRadiusMeter,
      isActive: outlets.isActive,
    })
    .from(outlets)
    .where(eq(outlets.companyId, actor.company.id))
    .orderBy(asc(outlets.code));
}
