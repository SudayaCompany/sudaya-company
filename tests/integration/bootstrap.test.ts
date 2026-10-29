import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLogs, userRoles, users } from "@/db/schema";
import {
  BootstrapRefused,
  assertBootstrapAllowed,
  bootstrapSuperAdmin,
} from "@/lib/auth/bootstrap";

import {
  createLiveContext,
  hasLiveEnv,
  type LiveContext,
  type TestCompany,
} from "../helpers/live";

describe.skipIf(!hasLiveEnv)("bootstrap Super Admin (DB live)", () => {
  let ctx: LiveContext;
  let company: TestCompany;

  beforeAll(async () => {
    ctx = createLiveContext();
    company = await ctx.createCompany("boot");
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  it("membuat Super Admin pertama, idempotent saat dijalankan ulang", async () => {
    const authUserId = await ctx.createAuthOnly();
    const input = { companyCode: company.code, authUserId, fullName: "Admin Pertama" };

    await expect(assertBootstrapAllowed(ctx.db, input)).resolves.toBeUndefined();
    expect((await bootstrapSuperAdmin(ctx.db, input)).status).toBe("created");
    expect((await bootstrapSuperAdmin(ctx.db, input)).status).toBe("already_super_admin");

    const userRows = await ctx.db.select().from(users).where(eq(users.id, authUserId));
    expect(userRows).toHaveLength(1);
    expect(userRows[0].companyId).toBe(company.id);

    const roleRows = await ctx.db
      .select()
      .from(userRoles)
      .where(eq(userRoles.userId, authUserId));
    expect(roleRows).toHaveLength(1);
    expect(roleRows[0].roleId).toBe(company.roleId("super_admin"));
    expect(roleRows[0].outletId).toBeNull();

    const audit = await ctx.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.companyId, company.id),
          eq(auditLogs.action, "auth.bootstrap_super_admin"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBeNull();
    expect(audit[0].entityId).toBe(authUserId);
  });

  it("menolak menjadikan akun lain Super Admin bila sudah ada", async () => {
    const other = await ctx.createAuthOnly();
    const input = { companyCode: company.code, authUserId: other, fullName: "Penyusup" };

    await expect(assertBootstrapAllowed(ctx.db, input)).rejects.toBeInstanceOf(BootstrapRefused);
    await expect(bootstrapSuperAdmin(ctx.db, input)).rejects.toBeInstanceOf(BootstrapRefused);
    const rows = await ctx.db.select().from(users).where(eq(users.id, other));
    expect(rows).toHaveLength(0);
  });

  it("menolak akun yang sudah terdaftar di company lain", async () => {
    const otherCompany = await ctx.createCompany("boot2");
    const staff = await ctx.createUser(company, [{ role: "barista", outlet: "outlet" }]);

    await expect(
      bootstrapSuperAdmin(ctx.db, {
        companyCode: otherCompany.code,
        authUserId: staff.id,
        fullName: "x",
      }),
    ).rejects.toThrow(/company lain/);
  });

  it("menolak company yang belum di-seed", async () => {
    await expect(
      bootstrapSuperAdmin(ctx.db, {
        companyCode: `missing-${ctx.runId}`,
        authUserId: await ctx.createAuthOnly(),
        fullName: "x",
      }),
    ).rejects.toThrow(/db:seed/);
  });
});
