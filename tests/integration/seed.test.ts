import { and, eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  brands,
  companies,
  outlets,
  permissions,
  rolePermissions,
  roles,
} from "@/db/schema";
import { seedInitialData } from "@/db/seed";

import { createLiveContext, hasLiveEnv, type LiveContext } from "../helpers/live";

describe.skipIf(!hasLiveEnv)("seed (DB live)", () => {
  let ctx: LiveContext;

  beforeAll(() => {
    ctx = createLiveContext();
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  async function counts() {
    const count = async (table: PgTable) => {
      const [row] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(table);
      return row.n;
    };
    return {
      companies: await count(companies),
      brands: await count(brands),
      outlets: await count(outlets),
      roles: await count(roles),
      permissions: await count(permissions),
      rolePermissions: await count(rolePermissions),
    };
  }

  it("seed dijalankan dua kali tidak membuat duplikat", async () => {
    await seedInitialData(ctx.db);
    const before = await counts();
    const report = await seedInitialData(ctx.db);
    const after = await counts();

    expect(after).toEqual(before);
    expect(report).toEqual({
      company: "existing",
      brand: "existing",
      outlet: "existing",
      permissionsCreated: 0,
      rolesCreated: [],
      rolePermissionsCreated: 0,
    });
  });

  it("data awal Sudaya Company → Sudaya Coffee → Outlet 01 valid", async () => {
    const [row] = await ctx.db
      .select({
        company: companies.name,
        brand: brands.name,
        outlet: outlets.name,
        radius: outlets.attendanceRadiusMeter,
        brandCompany: brands.companyId,
        outletCompany: outlets.companyId,
        companyId: companies.id,
      })
      .from(outlets)
      .innerJoin(brands, eq(brands.id, outlets.brandId))
      .innerJoin(companies, eq(companies.id, outlets.companyId))
      .where(eq(outlets.code, "SDY01"));

    expect(row.company).toBe("Sudaya Company");
    expect(row.brand).toBe("Sudaya Coffee");
    expect(row.outlet).toBe("Sudaya Coffee — Outlet 01");
    expect(row.radius).toBeGreaterThan(0);
    expect(row.brandCompany).toBe(row.companyId);
    expect(row.outletCompany).toBe(row.companyId);
  });

  it("tidak mereset pengaturan outlet & tidak mengembalikan permission yang dicabut", async () => {
    const company = await ctx.createCompany("seed");
    await ctx.db
      .update(outlets)
      .set({ attendanceRadiusMeter: 25 })
      .where(eq(outlets.id, company.outletId));
    await ctx.db
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, company.roleId("barista")),
          eq(rolePermissions.permissionCode, "kds.view"),
        ),
      );

    const report = await seedInitialData(ctx.db, company.target);
    expect(report.outlet).toBe("existing");
    expect(report.rolePermissionsCreated).toBe(0);

    const [outlet] = await ctx.db
      .select({ radius: outlets.attendanceRadiusMeter })
      .from(outlets)
      .where(eq(outlets.id, company.outletId));
    expect(outlet.radius).toBe(25);

    const restored = await ctx.db
      .select()
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, company.roleId("barista")),
          eq(rolePermissions.permissionCode, "kds.view"),
        ),
      );
    expect(restored).toHaveLength(0);
  });
});
