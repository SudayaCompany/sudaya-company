// Memuat identitas & hak akses user dari DB. Tidak bergantung pada Next.js
// sehingga bisa dipakai DAL, script, dan test.

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

import type { DbExecutor } from "@/db/client";
import {
  brands,
  companies,
  outlets,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "@/db/schema";

import type { AccessGrant, AccessSubject } from "./policy";

export type CurrentUser = AccessSubject & {
  id: string;
  email: string | null;
  fullName: string;
  isActive: boolean;
  company: { id: string; code: string; name: string };
};

export async function loadGrants(
  db: DbExecutor,
  userId: string,
  companyId: string,
): Promise<AccessGrant[]> {
  const rows = await db
    .select({
      userRoleId: userRoles.id,
      roleId: roles.id,
      roleCode: roles.code,
      roleName: roles.name,
      outletId: userRoles.outletId,
      permission: rolePermissions.permissionCode,
    })
    .from(userRoles)
    // Role & outlet wajib milik company user — assignment lintas company
    // (jika pernah terjadi) diabaikan.
    .innerJoin(
      roles,
      and(eq(roles.id, userRoles.roleId), eq(roles.companyId, companyId)),
    )
    .leftJoin(outlets, eq(outlets.id, userRoles.outletId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(
      and(
        eq(userRoles.userId, userId),
        or(isNull(userRoles.outletId), eq(outlets.companyId, companyId)),
      ),
    );

  const grants = new Map<string, AccessGrant & { permissions: string[] }>();
  for (const row of rows) {
    let grant = grants.get(row.userRoleId);
    if (!grant) {
      grant = {
        userRoleId: row.userRoleId,
        roleId: row.roleId,
        roleCode: row.roleCode,
        roleName: row.roleName,
        outletId: row.outletId,
        permissions: [],
      };
      grants.set(row.userRoleId, grant);
    }
    if (row.permission) grant.permissions.push(row.permission);
  }
  return [...grants.values()];
}

/**
 * JWT Supabase diverifikasi secara lokal, jadi token tetap "valid" sampai
 * kedaluwarsa walau user sudah logout. Cek ke auth.sessions agar logout &
 * pencabutan session langsung berlaku.
 */
export async function isSessionActive(
  db: DbExecutor,
  sessionId: string,
  userId: string,
) {
  const rows = await db.execute(
    sql`select 1 from auth.sessions
        where id = ${sessionId} and user_id = ${userId}
          and (not_after is null or not_after > now())
        limit 1`,
  );
  return rows.length > 0;
}

/** auth.users di-alias karena namanya sama dengan public.users. */
export const authUser = alias(authUsers, "auth_user");

export async function loadCurrentUser(
  db: DbExecutor,
  userId: string,
): Promise<CurrentUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      isActive: users.isActive,
      email: authUser.email,
      companyId: companies.id,
      companyCode: companies.code,
      companyName: companies.name,
    })
    .from(users)
    .innerJoin(companies, eq(companies.id, users.companyId))
    .leftJoin(authUser, eq(authUser.id, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    isActive: row.isActive,
    company: { id: row.companyId, code: row.companyCode, name: row.companyName },
    grants: await loadGrants(db, row.id, row.companyId),
  };
}

export type AccessibleOutlet = {
  id: string;
  code: string;
  name: string;
  brandId: string;
  brandName: string;
  timezone: string;
};

/** Outlet yang boleh diakses user: semua (grant company-wide) atau yang di-assign. */
export async function listAccessibleOutlets(
  db: DbExecutor,
  user: CurrentUser,
): Promise<AccessibleOutlet[]> {
  const companyWide = user.grants.some((grant) => grant.outletId === null);
  const outletIds = [
    ...new Set(user.grants.flatMap((g) => (g.outletId ? [g.outletId] : []))),
  ];
  if (!companyWide && outletIds.length === 0) return [];

  return db
    .select({
      id: outlets.id,
      code: outlets.code,
      name: outlets.name,
      brandId: brands.id,
      brandName: brands.name,
      timezone: outlets.timezone,
    })
    .from(outlets)
    .innerJoin(brands, eq(brands.id, outlets.brandId))
    .where(
      and(
        eq(outlets.companyId, user.company.id),
        eq(outlets.isActive, true),
        companyWide ? undefined : inArray(outlets.id, outletIds),
      ),
    )
    .orderBy(asc(outlets.code));
}
