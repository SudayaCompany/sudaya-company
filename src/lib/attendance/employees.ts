// Manajemen karyawan (PRD §5, Employee Management). Data karyawan terpisah
// dari akun login: akun (Supabase Auth + users + role) tetap dikelola di
// /admin/users; di sini karyawan ditautkan ke akun yang sudah ada. Password
// tidak pernah disimpan di tabel karyawan.

import { and, asc, desc, eq, ilike, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { Database, DbExecutor } from "@/db/client";
import {
  attendances,
  biometricConsents,
  employees,
  faceEnrollments,
  outlets,
  roles,
  userRoles,
  users,
} from "@/db/schema";
import { recordAudit, type AuditContext } from "@/lib/audit";
import { authUser, type CurrentUser } from "@/lib/auth/access";
import { AccessError } from "@/lib/auth/errors";
import { hasPermission } from "@/lib/auth/policy";
import type { Permission } from "@/lib/auth/rbac";
import { outletsWithPermission } from "@/lib/orders/engine";

import { revokeEnrollmentFor } from "./engine";
import type { FaceVerificationProvider } from "./face-provider";
import { employeeCreateInput, employeeUpdateInput } from "./schemas";

const forbidden = () => new AccessError("forbidden", "Anda tidak memiliki izin untuk tindakan ini.");
const notFound = () => new AccessError("not_found", "Karyawan tidak ditemukan.");

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AccessError("invalid", result.error.issues[0]?.message ?? "Input tidak valid.");
  }
  return result.data;
}

function assertAt(actor: CurrentUser, permission: Permission, outletId: string) {
  if (!actor.isActive || !hasPermission(actor, permission, { outletId })) throw forbidden();
}

function mapUniqueViolation(error: unknown): never {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    const e = current as { code?: string; constraint_name?: string; cause?: unknown };
    if (e.code === "23505") {
      throw new AccessError(
        "conflict",
        e.constraint_name?.includes("user") ? "Akun ini sudah ditautkan ke karyawan lain." : "Employee ID sudah dipakai karyawan lain.",
      );
    }
    current = e.cause;
  }
  throw error;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export const employeeListParams = z.object({
  q: z.string().trim().max(60).optional().catch(undefined),
  outlet: z.uuid().optional().catch(undefined),
  status: z.enum(["active", "inactive", "all"]).catch("active"),
});

export async function listEmployees(db: DbExecutor, actor: CurrentUser, params: z.infer<typeof employeeListParams>) {
  const allowed = await outletsWithPermission(db, actor, "employee.view");
  if (allowed.length === 0) throw forbidden();
  const outletIds = params.outlet ? allowed.filter((o) => o.id === params.outlet).map((o) => o.id) : allowed.map((o) => o.id);
  if (outletIds.length === 0) throw forbidden();

  const conditions: (SQL | undefined)[] = [
    eq(employees.companyId, actor.company.id),
    inArray(employees.outletId, outletIds),
  ];
  if (params.status !== "all") conditions.push(eq(employees.isActive, params.status === "active"));
  if (params.q) {
    const pattern = `%${escapeLike(params.q)}%`;
    conditions.push(or(ilike(employees.fullName, pattern), ilike(employees.employeeCode, pattern), ilike(authUser.email, pattern)));
  }

  const rows = await db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      fullName: employees.fullName,
      phone: employees.phone,
      position: employees.position,
      joinedAt: employees.joinedAt,
      isActive: employees.isActive,
      outletName: outlets.name,
      userId: employees.userId,
      email: authUser.email,
      accountActive: users.isActive,
      // Nama tabel eksplisit agar subquery berkorelasi ke baris luar.
      faceEnrolled: sql<boolean>`exists (select 1 from face_enrollments f where f.employee_id = employees.id and f.revoked_at is null)`,
    })
    .from(employees)
    .innerJoin(outlets, eq(outlets.id, employees.outletId))
    .leftJoin(users, eq(users.id, employees.userId))
    .leftJoin(authUser, eq(authUser.id, employees.userId))
    .where(and(...conditions))
    .orderBy(asc(employees.fullName))
    .limit(500);

  const roleRows = await rolesFor(db, actor, rows.flatMap((r) => (r.userId ? [r.userId] : [])));
  return {
    rows: rows.map((r) => ({ ...r, roles: roleRows.get(r.userId ?? "") ?? [] })),
    outlets: allowed,
  };
}
export type EmployeeRow = Awaited<ReturnType<typeof listEmployees>>["rows"][number];

async function rolesFor(db: DbExecutor, actor: CurrentUser, userIds: string[]) {
  const map = new Map<string, string[]>();
  if (userIds.length === 0) return map;
  const rows = await db
    .select({ userId: userRoles.userId, roleName: roles.name, outletName: outlets.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(outlets, eq(outlets.id, userRoles.outletId))
    .where(and(inArray(userRoles.userId, userIds), eq(roles.companyId, actor.company.id)));
  for (const r of rows) {
    const list = map.get(r.userId) ?? [];
    list.push(r.outletName ? `${r.roleName} (${r.outletName})` : r.roleName);
    map.set(r.userId, list);
  }
  return map;
}

export async function getEmployee(db: DbExecutor, actor: CurrentUser, employeeId: string) {
  const id = z.uuid().safeParse(employeeId);
  if (!id.success) throw notFound();
  const [employee] = await db
    .select({
      id: employees.id,
      companyId: employees.companyId,
      brandId: employees.brandId,
      outletId: employees.outletId,
      employeeCode: employees.employeeCode,
      fullName: employees.fullName,
      phone: employees.phone,
      position: employees.position,
      joinedAt: employees.joinedAt,
      isActive: employees.isActive,
      userId: employees.userId,
      outletName: outlets.name,
      timezone: outlets.timezone,
      email: authUser.email,
      accountActive: users.isActive,
      createdAt: employees.createdAt,
    })
    .from(employees)
    .innerJoin(outlets, eq(outlets.id, employees.outletId))
    .leftJoin(users, eq(users.id, employees.userId))
    .leftJoin(authUser, eq(authUser.id, employees.userId))
    .where(and(eq(employees.id, id.data), eq(employees.companyId, actor.company.id)))
    .limit(1);
  if (!employee) throw notFound();
  assertAt(actor, "employee.view", employee.outletId);

  const [roleMap, enrollments, consents, recent] = await Promise.all([
    rolesFor(db, actor, employee.userId ? [employee.userId] : []),
    // Hanya metadata minimum; referensi template di provider tidak ditampilkan.
    db
      .select({
        id: faceEnrollments.id,
        provider: faceEnrollments.provider,
        createdAt: faceEnrollments.createdAt,
        revokedAt: faceEnrollments.revokedAt,
        revokedReason: faceEnrollments.revokedReason,
        providerDeletedAt: faceEnrollments.providerDeletedAt,
      })
      .from(faceEnrollments)
      .where(eq(faceEnrollments.employeeId, employee.id))
      .orderBy(desc(faceEnrollments.createdAt)),
    db
      .select({
        id: biometricConsents.id,
        noticeVersion: biometricConsents.noticeVersion,
        basis: biometricConsents.basis,
        givenAt: biometricConsents.givenAt,
        withdrawnAt: biometricConsents.withdrawnAt,
      })
      .from(biometricConsents)
      .where(eq(biometricConsents.employeeId, employee.id))
      .orderBy(desc(biometricConsents.givenAt)),
    db
      .select({
        id: attendances.id,
        businessDate: attendances.businessDate,
        checkInAt: attendances.checkInAt,
        checkOutAt: attendances.checkOutAt,
        workingMinutes: attendances.workingMinutes,
        checkInMethod: attendances.checkInMethod,
        checkOutMethod: attendances.checkOutMethod,
        outsideDutyRequestId: attendances.outsideDutyRequestId,
      })
      .from(attendances)
      .where(eq(attendances.employeeId, employee.id))
      .orderBy(desc(attendances.checkInAt))
      .limit(10),
  ]);
  return {
    employee,
    roles: roleMap.get(employee.userId ?? "") ?? [],
    enrollments,
    activeEnrollment: enrollments.find((e) => !e.revokedAt) ?? null,
    consents,
    recent,
    canEdit: hasPermission(actor, "employee.edit", { outletId: employee.outletId }),
  };
}
export type EmployeeDetail = Awaited<ReturnType<typeof getEmployee>>;

/** Pilihan form: outlet yang diizinkan + akun staf yang belum ditautkan. */
export async function employeeFormOptions(
  db: DbExecutor,
  actor: CurrentUser,
  permission: "employee.create" | "employee.edit",
  currentUserId: string | null = null,
) {
  const allowed = await outletsWithPermission(db, actor, permission);
  if (allowed.length === 0) throw forbidden();
  const linked = db.select({ id: employees.userId }).from(employees).where(sql`${employees.userId} is not null`);
  const accounts = await db
    .select({ id: users.id, fullName: users.fullName, email: authUser.email })
    .from(users)
    .leftJoin(authUser, eq(authUser.id, users.id))
    .where(
      and(
        eq(users.companyId, actor.company.id),
        eq(users.isActive, true),
        currentUserId ? or(eq(users.id, currentUserId), notInArray(users.id, linked)) : notInArray(users.id, linked),
      ),
    )
    .orderBy(asc(users.fullName));
  return { outlets: allowed, accounts };
}

async function assertLinkableUser(db: DbExecutor, actor: CurrentUser, userId: string | null, employeeId?: string) {
  if (!userId) return;
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, actor.company.id)))
    .limit(1);
  if (!user) throw new AccessError("invalid", "Akun tidak ditemukan di company ini.");
  const [other] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.userId, userId), employeeId ? sql`${employees.id} <> ${employeeId}` : undefined))
    .limit(1);
  if (other) throw new AccessError("conflict", "Akun ini sudah ditautkan ke karyawan lain.");
}

async function loadOutlet(db: DbExecutor, actor: CurrentUser, outletId: string) {
  const [outlet] = await db
    .select({ id: outlets.id, brandId: outlets.brandId })
    .from(outlets)
    .where(and(eq(outlets.id, outletId), eq(outlets.companyId, actor.company.id)))
    .limit(1);
  if (!outlet) throw new AccessError("invalid", "Outlet tidak ditemukan.");
  return outlet;
}

export async function createEmployee(db: Database, actor: CurrentUser, raw: unknown, context: AuditContext) {
  const input = parse(employeeCreateInput, raw);
  const outlet = await loadOutlet(db, actor, input.outletId);
  assertAt(actor, "employee.create", outlet.id);
  await assertLinkableUser(db, actor, input.userId);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(employees)
        .values({
          companyId: actor.company.id,
          brandId: outlet.brandId,
          outletId: outlet.id,
          userId: input.userId,
          employeeCode: input.employeeCode,
          fullName: input.fullName,
          phone: input.phone,
          position: input.position,
          joinedAt: input.joinedAt,
        })
        .returning({ id: employees.id });
      await recordAudit(
        tx,
        {
          companyId: actor.company.id,
          brandId: outlet.brandId,
          outletId: outlet.id,
          actorId: actor.id,
          action: "employee.created",
          entityType: "employee",
          entityId: row.id,
          after: { employeeCode: input.employeeCode, fullName: input.fullName, position: input.position, userId: input.userId },
        },
        context,
      );
      return { id: row.id };
    });
  } catch (error) {
    mapUniqueViolation(error);
  }
}

export async function updateEmployee(
  db: Database,
  actor: CurrentUser,
  raw: unknown,
  provider: FaceVerificationProvider | null,
  context: AuditContext,
) {
  const input = parse(employeeUpdateInput, raw);
  const [current] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, input.employeeId), eq(employees.companyId, actor.company.id)))
    .limit(1);
  if (!current) throw notFound();
  assertAt(actor, "employee.edit", current.outletId);
  const outlet = await loadOutlet(db, actor, input.outletId);
  assertAt(actor, "employee.edit", outlet.id);
  await assertLinkableUser(db, actor, input.userId, current.id);

  const next = {
    fullName: input.fullName,
    phone: input.phone,
    position: input.position,
    outletId: outlet.id,
    brandId: outlet.brandId,
    joinedAt: input.joinedAt,
    userId: input.userId,
    isActive: input.isActive,
  };
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    if (current[key] !== next[key]) {
      before[key] = current[key];
      after[key] = next[key];
    }
  }
  try {
    await db.transaction(async (tx) => {
      await tx.update(employees).set(next).where(eq(employees.id, current.id));
      if (Object.keys(after).length) {
        await recordAudit(
          tx,
          {
            companyId: actor.company.id,
            brandId: outlet.brandId,
            outletId: outlet.id,
            actorId: actor.id,
            action: "employee.updated",
            entityType: "employee",
            entityId: current.id,
            before,
            after,
          },
          context,
        );
      }
    });
  } catch (error) {
    mapUniqueViolation(error);
  }

  // Retensi: karyawan dinonaktifkan → registrasi wajah dicabut & dihapus di provider.
  let revoked = { revoked: 0, pendingProviderDeletion: 0 };
  if (current.isActive && !input.isActive) {
    revoked = await revokeEnrollmentFor(
      db,
      actor,
      { id: current.id, companyId: current.companyId, brandId: outlet.brandId, outletId: outlet.id },
      { reason: "Karyawan dinonaktifkan (kebijakan retensi)", withdrawConsent: false },
      provider,
      context,
    );
  }
  return { id: current.id, ...revoked };
}
