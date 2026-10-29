// Operasi administrasi akses (user, role, permission) + query untuk halaman
// admin. Setiap fungsi menerima actor yang sudah terautentikasi dan
// memverifikasi ulang permission, scope company/outlet, dan aturan
// anti privilege escalation — jangan pernah percaya input dari client.

import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { z } from "zod";

import type { Database, DbExecutor } from "@/db/client";
import {
  auditLogs,
  outlets,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "@/db/schema";
import { recordAudit, type AuditContext } from "@/lib/audit";

import { authUser, loadGrants, type CurrentUser } from "./access";
import { AccessError } from "./errors";
import {
  coversPermissions,
  dominates,
  hasPermission,
  type AccessGrant,
  type AccessScope,
} from "./policy";
import { SUPER_ADMIN_ROLE, type Permission } from "./rbac";

/** Operasi Supabase Auth Admin, di-inject agar bisa diganti saat test. */
export type AuthAdmin = {
  createInvite(
    email: string,
    fullName: string,
  ): Promise<{ userId: string; hashedToken: string }>;
  setBanned(userId: string, banned: boolean): Promise<void>;
};

function assertPermission(
  actor: CurrentUser,
  permission: Permission,
  scope?: AccessScope,
) {
  if (!actor.isActive || !hasPermission(actor, permission, scope)) {
    throw new AccessError("forbidden", "Anda tidak memiliki izin untuk tindakan ini.");
  }
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AccessError(
      "invalid",
      result.error.issues[0]?.message ?? "Input tidak valid.",
    );
  }
  return result.data;
}

const notFound = () => new AccessError("not_found", "Data tidak ditemukan.");

async function loadTargetUser(db: DbExecutor, actor: CurrentUser, userId: string) {
  const [row] = await db
    .select({ id: users.id, fullName: users.fullName, isActive: users.isActive })
    .from(users)
    // Scope company: user company lain diperlakukan sebagai tidak ada.
    .where(and(eq(users.id, userId), eq(users.companyId, actor.company.id)))
    .limit(1);
  if (!row) throw notFound();
  return { ...row, grants: await loadGrants(db, row.id, actor.company.id) };
}

async function loadRole(db: DbExecutor, actor: CurrentUser, roleId: string) {
  const [role] = await db
    .select({ id: roles.id, code: roles.code, name: roles.name })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.companyId, actor.company.id)))
    .limit(1);
  if (!role) throw notFound();
  const perms = await db
    .select({ code: rolePermissions.permissionCode })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, role.id));
  return { ...role, permissions: perms.map((p) => p.code) };
}

async function assertOutletInCompany(
  db: DbExecutor,
  actor: CurrentUser,
  outletId: string | null,
) {
  if (outletId === null) return null;
  const [outlet] = await db
    .select({ id: outlets.id, brandId: outlets.brandId })
    .from(outlets)
    .where(and(eq(outlets.id, outletId), eq(outlets.companyId, actor.company.id)))
    .limit(1);
  if (!outlet) throw notFound();
  return outlet;
}

function assertNotSelf(actor: CurrentUser, userId: string) {
  if (actor.id === userId) {
    throw new AccessError("forbidden", "Anda tidak bisa mengubah akses akun sendiri.");
  }
}

function assertDominates(
  actor: CurrentUser,
  target: { grants: AccessGrant[] },
  scope: AccessScope,
) {
  if (!dominates(actor, target, scope)) {
    throw new AccessError(
      "forbidden",
      "Akun ini memiliki akses yang lebih luas dari akses Anda.",
    );
  }
}

function assertCanGrant(
  actor: CurrentUser,
  rolePermissionCodes: string[],
  scope: AccessScope,
) {
  if (!coversPermissions(actor, rolePermissionCodes, scope)) {
    throw new AccessError(
      "forbidden",
      "Role ini memiliki permission yang tidak Anda miliki.",
    );
  }
}

// --- Queries -----------------------------------------------------------------

export type CompanyUserRow = {
  id: string;
  fullName: string;
  email: string | null;
  isActive: boolean;
  grants: (AccessGrant & { outletName: string | null })[];
};

export async function listCompanyUsers(
  db: DbExecutor,
  actor: CurrentUser,
): Promise<CompanyUserRow[]> {
  assertPermission(actor, "user.manage");

  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      isActive: users.isActive,
      email: authUser.email,
    })
    .from(users)
    .leftJoin(authUser, eq(authUser.id, users.id))
    .where(eq(users.companyId, actor.company.id))
    .orderBy(asc(users.fullName));

  const grantRows = await db
    .select({
      userId: userRoles.userId,
      userRoleId: userRoles.id,
      roleId: roles.id,
      roleCode: roles.code,
      roleName: roles.name,
      outletId: userRoles.outletId,
      outletName: outlets.name,
    })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(outlets, eq(outlets.id, userRoles.outletId))
    .where(
      and(
        eq(users.companyId, actor.company.id),
        eq(roles.companyId, actor.company.id),
      ),
    )
    .orderBy(asc(roles.name));

  return rows.map((row) => ({
    ...row,
    grants: grantRows
      .filter((g) => g.userId === row.id)
      .map((g) => ({ ...g, permissions: [] })),
  }));
}

export type RoleRow = {
  id: string;
  code: string;
  name: string;
  permissions: string[];
};

export async function listCompanyRoles(
  db: DbExecutor,
  actor: CurrentUser,
): Promise<RoleRow[]> {
  if (
    !hasPermission(actor, "user.manage") &&
    !hasPermission(actor, "role.manage")
  ) {
    throw new AccessError("forbidden", "Anda tidak memiliki izin untuk tindakan ini.");
  }

  const rows = await db
    .select({
      id: roles.id,
      code: roles.code,
      name: roles.name,
      permission: rolePermissions.permissionCode,
    })
    .from(roles)
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(eq(roles.companyId, actor.company.id))
    .orderBy(asc(roles.createdAt));

  const byId = new Map<string, RoleRow>();
  for (const row of rows) {
    const role = byId.get(row.id) ?? {
      id: row.id,
      code: row.code,
      name: row.name,
      permissions: [],
    };
    if (row.permission) role.permissions.push(row.permission);
    byId.set(row.id, role);
  }
  return [...byId.values()];
}

export async function listPermissions(db: DbExecutor) {
  return db
    .select({ code: permissions.code, description: permissions.description })
    .from(permissions)
    .orderBy(asc(permissions.code));
}

export async function listCompanyOutlets(db: DbExecutor, actor: CurrentUser) {
  return db
    .select({ id: outlets.id, code: outlets.code, name: outlets.name })
    .from(outlets)
    .where(eq(outlets.companyId, actor.company.id))
    .orderBy(asc(outlets.code));
}

export async function listAuditLogs(
  db: DbExecutor,
  actor: CurrentUser,
  limit = 100,
) {
  assertPermission(actor, "audit.view");
  const actorUser = alias(users, "actor_user");

  return db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      reason: auditLogs.reason,
      before: auditLogs.before,
      after: auditLogs.after,
      ip: auditLogs.ip,
      actorName: actorUser.fullName,
    })
    .from(auditLogs)
    .leftJoin(actorUser, eq(actorUser.id, auditLogs.actorId))
    .where(eq(auditLogs.companyId, actor.company.id))
    .orderBy(desc(auditLogs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}

// --- Mutations ---------------------------------------------------------------

const uuid = z.uuid({ error: "ID tidak valid." });

export const assignRoleInput = z.object({
  userId: uuid,
  roleId: uuid,
  outletId: uuid.nullable(),
});

export async function assignRole(
  db: Database,
  actor: CurrentUser,
  rawInput: unknown,
  context: AuditContext,
) {
  const input = parse(assignRoleInput, rawInput);
  const scope = { outletId: input.outletId };
  assertPermission(actor, "user.manage", scope);
  assertNotSelf(actor, input.userId);

  await db.transaction(async (tx) => {
    const target = await loadTargetUser(tx, actor, input.userId);
    const role = await loadRole(tx, actor, input.roleId);
    const outlet = await assertOutletInCompany(tx, actor, input.outletId);
    assertDominates(actor, target, scope);
    assertCanGrant(actor, role.permissions, scope);

    const inserted = await tx
      .insert(userRoles)
      .values({ userId: target.id, roleId: role.id, outletId: input.outletId })
      .onConflictDoNothing()
      .returning({ id: userRoles.id });
    if (inserted.length === 0) {
      throw new AccessError("conflict", "User sudah memiliki role ini.");
    }

    await recordAudit(
      tx,
      {
        companyId: actor.company.id,
        brandId: outlet?.brandId,
        outletId: input.outletId,
        actorId: actor.id,
        action: "rbac.role_assigned",
        entityType: "user",
        entityId: target.id,
        after: { role: role.code, outletId: input.outletId },
      },
      context,
    );
  });
}

export const revokeRoleInput = z.object({ userRoleId: uuid });

export async function revokeRole(
  db: Database,
  actor: CurrentUser,
  rawInput: unknown,
  context: AuditContext,
) {
  const input = parse(revokeRoleInput, rawInput);

  await db.transaction(async (tx) => {
    const [assignment] = await tx
      .select({
        id: userRoles.id,
        userId: userRoles.userId,
        roleId: userRoles.roleId,
        outletId: userRoles.outletId,
      })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(
        and(eq(userRoles.id, input.userRoleId), eq(users.companyId, actor.company.id)),
      )
      .limit(1);
    if (!assignment) throw notFound();

    const scope = { outletId: assignment.outletId };
    assertPermission(actor, "user.manage", scope);
    assertNotSelf(actor, assignment.userId);

    const target = await loadTargetUser(tx, actor, assignment.userId);
    const role = await loadRole(tx, actor, assignment.roleId);
    assertDominates(actor, target, scope);
    assertCanGrant(actor, role.permissions, scope);

    if (role.code === SUPER_ADMIN_ROLE && assignment.outletId === null) {
      // Cegah company kehilangan Super Admin aktif terakhir.
      const [{ remaining }] = await tx
        .select({ remaining: sql<number>`count(*)::int` })
        .from(userRoles)
        .innerJoin(users, eq(users.id, userRoles.userId))
        .where(
          and(
            eq(userRoles.roleId, role.id),
            isNull(userRoles.outletId),
            eq(users.isActive, true),
            ne(userRoles.id, assignment.id),
          ),
        );
      if (remaining < 1) {
        throw new AccessError("conflict", "Tidak bisa mencabut Super Admin terakhir.");
      }
    }

    await tx.delete(userRoles).where(eq(userRoles.id, assignment.id));
    await recordAudit(
      tx,
      {
        companyId: actor.company.id,
        outletId: assignment.outletId,
        actorId: actor.id,
        action: "rbac.role_revoked",
        entityType: "user",
        entityId: target.id,
        before: { role: role.code, outletId: assignment.outletId },
      },
      context,
    );
  });
}

export const setUserActiveInput = z.object({
  userId: uuid,
  isActive: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Status di tabel users adalah sumber kebenaran (dicek di setiap request).
 * Ban di Supabase Auth adalah lapisan tambahan agar token tidak bisa
 * di-refresh; kegagalannya dilaporkan sebagai peringatan.
 */
export async function setUserActive(
  db: Database,
  actor: CurrentUser,
  rawInput: unknown,
  context: AuditContext,
  authAdmin: Pick<AuthAdmin, "setBanned">,
): Promise<{ warning?: string }> {
  const input = parse(setUserActiveInput, rawInput);
  assertPermission(actor, "user.manage", { outletId: null });
  assertNotSelf(actor, input.userId);

  const changed = await db.transaction(async (tx) => {
    const target = await loadTargetUser(tx, actor, input.userId);
    assertDominates(actor, target, { outletId: null });
    if (target.isActive === input.isActive) return false;

    await tx
      .update(users)
      .set({ isActive: input.isActive })
      .where(eq(users.id, target.id));
    await recordAudit(
      tx,
      {
        companyId: actor.company.id,
        actorId: actor.id,
        action: "user.status_changed",
        entityType: "user",
        entityId: target.id,
        before: { isActive: target.isActive },
        after: { isActive: input.isActive },
        reason: input.reason,
      },
      context,
    );
    return true;
  });

  if (!changed) return {};
  try {
    await authAdmin.setBanned(input.userId, !input.isActive);
    return {};
  } catch {
    return {
      warning:
        "Status tersimpan, tetapi sinkronisasi ke Supabase Auth gagal. Coba ulangi nanti.",
    };
  }
}

export const setRolePermissionInput = z.object({
  roleId: uuid,
  permissionCode: z
    .string()
    .regex(/^[a-z_]+\.[a-z_]+$/, { error: "Kode permission tidak valid." }),
  granted: z.boolean(),
});

export async function setRolePermission(
  db: Database,
  actor: CurrentUser,
  rawInput: unknown,
  context: AuditContext,
) {
  const input = parse(setRolePermissionInput, rawInput);
  assertPermission(actor, "role.manage", { outletId: null });

  await db.transaction(async (tx) => {
    const role = await loadRole(tx, actor, input.roleId);
    if (role.code === SUPER_ADMIN_ROLE) {
      throw new AccessError("forbidden", "Permission Super Admin tidak bisa diubah.");
    }
    if (actor.grants.some((grant) => grant.roleId === role.id)) {
      throw new AccessError(
        "forbidden",
        "Anda tidak bisa mengubah permission role yang Anda pegang sendiri.",
      );
    }
    if (!coversPermissions(actor, [input.permissionCode], { outletId: null })) {
      throw new AccessError(
        "forbidden",
        "Anda hanya bisa mengatur permission yang Anda miliki sendiri.",
      );
    }
    const [exists] = await tx
      .select({ code: permissions.code })
      .from(permissions)
      .where(eq(permissions.code, input.permissionCode))
      .limit(1);
    if (!exists) throw notFound();

    const changed = input.granted
      ? await tx
          .insert(rolePermissions)
          .values({ roleId: role.id, permissionCode: input.permissionCode })
          .onConflictDoNothing()
          .returning({ roleId: rolePermissions.roleId })
      : await tx
          .delete(rolePermissions)
          .where(
            and(
              eq(rolePermissions.roleId, role.id),
              eq(rolePermissions.permissionCode, input.permissionCode),
            ),
          )
          .returning({ roleId: rolePermissions.roleId });
    if (changed.length === 0) return;

    await recordAudit(
      tx,
      {
        companyId: actor.company.id,
        actorId: actor.id,
        action: input.granted ? "rbac.permission_granted" : "rbac.permission_revoked",
        entityType: "role",
        entityId: role.id,
        after: { role: role.code, permission: input.permissionCode },
      },
      context,
    );
  });
}

export const inviteStaffInput = z.object({
  email: z.email({ error: "Format email tidak valid." }).trim().toLowerCase(),
  fullName: z
    .string()
    .trim()
    .min(2, { error: "Nama minimal 2 karakter." })
    .max(100),
  roleId: uuid,
  outletId: uuid.nullable(),
});

export type InviteResult =
  | { status: "invited"; userId: string; hashedToken: string }
  | { status: "linked"; userId: string };

/**
 * Mendaftarkan staf baru. Jika email belum ada di Supabase Auth, dibuat
 * undangan (user memilih password sendiri lewat link). Jika sudah ada
 * (mis. dibuat via dashboard Supabase), akun tsb langsung dihubungkan.
 */
export async function inviteStaff(
  db: Database,
  actor: CurrentUser,
  rawInput: unknown,
  context: AuditContext,
  authAdmin: Pick<AuthAdmin, "createInvite">,
): Promise<InviteResult> {
  const input = parse(inviteStaffInput, rawInput);
  const scope = { outletId: input.outletId };
  assertPermission(actor, "user.manage", scope);

  // Validasi role & outlet sebelum menyentuh Supabase Auth.
  const role = await loadRole(db, actor, input.roleId);
  const outlet = await assertOutletInCompany(db, actor, input.outletId);
  assertCanGrant(actor, role.permissions, scope);

  const [existingAuth] = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(sql`lower(${authUsers.email}) = ${input.email}`)
    .limit(1);

  if (existingAuth) {
    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, existingAuth.id))
      .limit(1);
    if (existingUser) {
      throw new AccessError("conflict", "Email ini sudah terdaftar sebagai staf.");
    }
  }

  const invite = existingAuth
    ? null
    : await authAdmin.createInvite(input.email, input.fullName);
  const userId = existingAuth?.id ?? invite!.userId;

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      companyId: actor.company.id,
      fullName: input.fullName,
    });
    await tx
      .insert(userRoles)
      .values({ userId, roleId: role.id, outletId: input.outletId });
    await recordAudit(
      tx,
      {
        companyId: actor.company.id,
        brandId: outlet?.brandId,
        outletId: input.outletId,
        actorId: actor.id,
        action: invite ? "user.invited" : "user.linked",
        entityType: "user",
        entityId: userId,
        after: { email: input.email, role: role.code, outletId: input.outletId },
      },
      context,
    );
  });

  return invite
    ? { status: "invited", userId, hashedToken: invite.hashedToken }
    : { status: "linked", userId };
}
