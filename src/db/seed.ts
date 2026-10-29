// Seeder idempotent: hanya INSERT ... ON CONFLICT DO NOTHING, tidak pernah
// UPDATE/DELETE, sehingga pengaturan dan kustomisasi yang ada tidak tereset.

import { and, eq, inArray, sql } from "drizzle-orm";

import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_CODES,
  ROLES,
  ROLE_CODES,
  SUPER_ADMIN_ROLE,
} from "@/lib/auth/rbac";

import type { Database } from "./client";
import {
  brands,
  companies,
  outlets,
  permissions,
  rolePermissions,
  roles,
} from "./schema";

export const INITIAL_COMPANY = { code: "sudaya", name: "Sudaya Company" };
export const INITIAL_BRAND = { code: "sudaya-coffee", name: "Sudaya Coffee" };
export const INITIAL_OUTLET = {
  // Dipakai di URL QR: /order?outlet=SDY01 (PRD §110).
  code: "SDY01",
  name: "Sudaya Coffee — Outlet 01",
  // Alamat & koordinat belum diketahui → null, diisi Super Admin nanti.
  // Radius absensi memakai default kolom (5 meter).
};

export type SeedReport = {
  company: "created" | "existing";
  brand: "created" | "existing";
  outlet: "created" | "existing";
  permissionsCreated: number;
  rolesCreated: string[];
  rolePermissionsCreated: number;
};

export type SeedTarget = {
  company: { code: string; name: string };
  brand: { code: string; name: string };
  outlet: { code: string; name: string };
};

const INITIAL_TARGET: SeedTarget = {
  company: INITIAL_COMPANY,
  brand: INITIAL_BRAND,
  outlet: INITIAL_OUTLET,
};

/** Target bisa diganti (dipakai test untuk company sementara). */
export async function seedInitialData(
  db: Database,
  target: SeedTarget = INITIAL_TARGET,
): Promise<SeedReport> {
  return db.transaction(async (tx) => {
    // Cegah dua seeder berjalan bersamaan.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sudaya:seed'))`);

    // --- Company → Brand → Outlet -----------------------------------------
    const createdCompany = await tx
      .insert(companies)
      .values(target.company)
      .onConflictDoNothing({ target: companies.code })
      .returning({ id: companies.id });
    const [company] = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.code, target.company.code));

    const createdBrand = await tx
      .insert(brands)
      .values({ ...target.brand, companyId: company.id })
      .onConflictDoNothing({ target: [brands.companyId, brands.code] })
      .returning({ id: brands.id });
    const [brand] = await tx
      .select({ id: brands.id })
      .from(brands)
      .where(
        and(eq(brands.companyId, company.id), eq(brands.code, target.brand.code)),
      );

    const createdOutlet = await tx
      .insert(outlets)
      .values({ ...target.outlet, companyId: company.id, brandId: brand.id })
      .onConflictDoNothing({ target: outlets.code })
      .returning({ id: outlets.id });

    // --- Permissions --------------------------------------------------------
    const createdPermissions = await tx
      .insert(permissions)
      .values(
        PERMISSION_CODES.map((code) => ({
          code,
          description: PERMISSIONS[code],
        })),
      )
      .onConflictDoNothing({ target: permissions.code })
      .returning({ code: permissions.code });

    // --- Roles --------------------------------------------------------------
    const createdRoles = await tx
      .insert(roles)
      .values(
        ROLE_CODES.map((code) => ({
          companyId: company.id,
          code,
          name: ROLES[code].name,
        })),
      )
      .onConflictDoNothing({ target: [roles.companyId, roles.code] })
      .returning({ id: roles.id, code: roles.code });

    const roleRows = await tx
      .select({ id: roles.id, code: roles.code })
      .from(roles)
      .where(
        and(eq(roles.companyId, company.id), inArray(roles.code, [...ROLE_CODES])),
      );
    const roleIdByCode = new Map(roleRows.map((r) => [r.code, r.id]));

    // --- Role → Permission --------------------------------------------------
    // Super Admin selalu mendapat semua permission (termasuk permission baru).
    // Role lain hanya diberi default saat role itu baru dibuat, supaya
    // permission yang sengaja dicabut admin tidak dikembalikan oleh seeder.
    const mapping: { roleId: string; permissionCode: string }[] = [];
    const superAdminId = roleIdByCode.get(SUPER_ADMIN_ROLE)!;
    for (const code of PERMISSION_CODES) {
      mapping.push({ roleId: superAdminId, permissionCode: code });
    }
    for (const role of createdRoles) {
      if (role.code === SUPER_ADMIN_ROLE) continue;
      const defaults =
        DEFAULT_ROLE_PERMISSIONS[role.code as keyof typeof DEFAULT_ROLE_PERMISSIONS];
      for (const code of defaults) {
        mapping.push({ roleId: role.id, permissionCode: code });
      }
    }

    const createdMappings = await tx
      .insert(rolePermissions)
      .values(mapping)
      .onConflictDoNothing()
      .returning({ roleId: rolePermissions.roleId });

    return {
      company: createdCompany.length ? "created" : "existing",
      brand: createdBrand.length ? "created" : "existing",
      outlet: createdOutlet.length ? "created" : "existing",
      permissionsCreated: createdPermissions.length,
      rolesCreated: createdRoles.map((r) => r.code),
      rolePermissionsCreated: createdMappings.length,
    };
  });
}
