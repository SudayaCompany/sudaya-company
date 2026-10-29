import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { companies, roles, userRoles, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit";

import { SUPER_ADMIN_ROLE } from "./rbac";

export class BootstrapRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapRefused";
  }
}

/**
 * Cek awal sebelum membuat akun di Supabase Auth, agar tidak tercipta akun
 * yatim saat bootstrap pasti ditolak. Pengecekan final tetap di dalam
 * transaksi bootstrapSuperAdmin.
 */
export async function assertBootstrapAllowed(
  db: Database,
  input: { companyCode: string; authUserId?: string },
) {
  const admins = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(companies, eq(companies.id, roles.companyId))
    .where(
      and(
        eq(companies.code, input.companyCode),
        eq(roles.code, SUPER_ADMIN_ROLE),
        isNull(userRoles.outletId),
      ),
    );
  if (admins.length > 0 && !admins.some((a) => a.userId === input.authUserId)) {
    throw new BootstrapRefused(
      "Company ini sudah memiliki Super Admin. Tambahkan admin lain lewat menu Pengguna di /admin/users.",
    );
  }
}

/**
 * Menjadikan akun Supabase Auth yang sudah ada sebagai Super Admin pertama
 * sebuah company. Menolak jika company sudah punya Super Admin lain, supaya
 * script tidak bisa dipakai untuk memperluas hak akses akun lain.
 */
export async function bootstrapSuperAdmin(
  db: Database,
  input: { companyCode: string; authUserId: string; fullName: string },
): Promise<{ status: "created" | "already_super_admin"; companyName: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('sudaya:admin-bootstrap'))`,
    );

    const [company] = await tx
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(eq(companies.code, input.companyCode))
      .limit(1);
    if (!company) {
      throw new BootstrapRefused(
        `Company "${input.companyCode}" belum ada. Jalankan "npm run db:seed" dulu.`,
      );
    }

    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.companyId, company.id), eq(roles.code, SUPER_ADMIN_ROLE)))
      .limit(1);
    if (!role) {
      throw new BootstrapRefused(
        `Role ${SUPER_ADMIN_ROLE} belum ada. Jalankan "npm run db:seed" dulu.`,
      );
    }

    const existingAdmins = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(and(eq(userRoles.roleId, role.id), isNull(userRoles.outletId)));

    if (existingAdmins.some((a) => a.userId === input.authUserId)) {
      return { status: "already_super_admin", companyName: company.name };
    }
    if (existingAdmins.length > 0) {
      throw new BootstrapRefused(
        "Company ini sudah memiliki Super Admin. Tambahkan admin lain lewat menu Pengguna di /admin/users.",
      );
    }

    const [existingUser] = await tx
      .select({ companyId: users.companyId, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, input.authUserId))
      .limit(1);
    if (existingUser && existingUser.companyId !== company.id) {
      throw new BootstrapRefused("Akun ini sudah terdaftar di company lain.");
    }
    if (existingUser && !existingUser.isActive) {
      throw new BootstrapRefused("Akun ini berstatus nonaktif.");
    }

    if (!existingUser) {
      await tx.insert(users).values({
        id: input.authUserId,
        companyId: company.id,
        fullName: input.fullName,
      });
    }
    await tx
      .insert(userRoles)
      .values({ userId: input.authUserId, roleId: role.id, outletId: null })
      .onConflictDoNothing();

    await recordAudit(tx, {
      companyId: company.id,
      actorId: null,
      action: "auth.bootstrap_super_admin",
      entityType: "user",
      entityId: input.authUserId,
      after: { role: SUPER_ADMIN_ROLE, outletId: null },
      reason: "npm run admin:bootstrap",
    });

    return { status: "created", companyName: company.name };
  });
}
