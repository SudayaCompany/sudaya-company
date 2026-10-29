import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { rolePermissions, roles, userRoles, users } from "@/db/schema";
import {
  assignRole,
  inviteStaff,
  listAuditLogs,
  listCompanyUsers,
  revokeRole,
  setRolePermission,
  setUserActive,
  type AuthAdmin,
} from "@/lib/auth/admin-ops";
import { AccessError } from "@/lib/auth/errors";
import { PERMISSION_CODES } from "@/lib/auth/rbac";
import { supabaseAuthAdmin } from "@/lib/supabase/admin";

import {
  createLiveContext,
  hasLiveEnv,
  type LiveContext,
  type TestCompany,
  type TestUser,
} from "../helpers/live";

const ctxAudit = { ip: "127.0.0.1", userAgent: "vitest" };

async function expectAccessError(promise: Promise<unknown>, code: AccessError["code"]) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
}

describe.skipIf(!hasLiveEnv)("kontrol akses server-side (DB live)", () => {
  let ctx: LiveContext;
  let A: TestCompany;
  let B: TestCompany;
  let superA: TestUser;
  let managerA: TestUser;
  let baristaA: TestUser;
  let cashierA: TestUser;
  let baristaB: TestUser;

  const fakeAuthAdmin = {
    setBanned: vi.fn(async () => {}),
    createInvite: vi.fn<AuthAdmin["createInvite"]>(),
  };

  beforeAll(async () => {
    ctx = createLiveContext();
    A = await ctx.createCompany("a");
    B = await ctx.createCompany("b");
    superA = await ctx.createUser(A, [{ role: "super_admin" }]);
    managerA = await ctx.createUser(A, [{ role: "manager", outlet: "outlet" }]);
    baristaA = await ctx.createUser(A, [{ role: "barista", outlet: "outlet" }]);
    cashierA = await ctx.createUser(A, [{ role: "cashier", outlet: "outlet" }]);
    await ctx.createUser(B, [{ role: "super_admin" }]);
    baristaB = await ctx.createUser(B, [{ role: "barista", outlet: "outlet" }]);
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  describe("isolasi company", () => {
    it("user company A tidak bisa membaca user company B", async () => {
      const list = await listCompanyUsers(ctx.db, superA.current);
      const ids = list.map((u) => u.id);
      expect(ids).toContain(baristaA.id);
      expect(ids).not.toContain(baristaB.id);
    });

    it("tidak bisa mengubah user company B (diperlakukan tidak ada)", async () => {
      await expectAccessError(
        assignRole(ctx.db, superA.current, {
          userId: baristaB.id,
          roleId: A.roleId("cashier"),
          outletId: null,
        }, ctxAudit),
        "not_found",
      );
      await expectAccessError(
        setUserActive(ctx.db, superA.current, { userId: baristaB.id, isActive: false }, ctxAudit, fakeAuthAdmin),
        "not_found",
      );
    });

    it("tidak bisa memakai role atau outlet milik company B", async () => {
      await expectAccessError(
        assignRole(ctx.db, superA.current, {
          userId: cashierA.id,
          roleId: B.roleId("manager"),
          outletId: null,
        }, ctxAudit),
        "not_found",
      );
      await expectAccessError(
        assignRole(ctx.db, superA.current, {
          userId: cashierA.id,
          roleId: A.roleId("barista"),
          outletId: B.outletId,
        }, ctxAudit),
        "not_found",
      );
    });

    it("audit log company B tidak terlihat dari company A", async () => {
      const logs = await listAuditLogs(ctx.db, superA.current);
      expect(logs.every((log) => log.entityId !== baristaB.id)).toBe(true);
    });
  });

  describe("permission & privilege escalation", () => {
    it("barista tidak bisa membaca daftar user", async () => {
      await expectAccessError(listCompanyUsers(ctx.db, baristaA.current), "forbidden");
    });

    it("barista tidak bisa menaikkan dirinya menjadi Super Admin", async () => {
      await expectAccessError(
        assignRole(ctx.db, baristaA.current, {
          userId: baristaA.id,
          roleId: A.roleId("super_admin"),
          outletId: null,
        }, ctxAudit),
        "forbidden",
      );
      const grants = await ctx.db.select().from(userRoles).where(eq(userRoles.userId, baristaA.id));
      expect(grants).toHaveLength(1);
    });

    it("barista tidak bisa menonaktifkan user lain", async () => {
      await expectAccessError(
        setUserActive(ctx.db, baristaA.current, { userId: cashierA.id, isActive: false }, ctxAudit, fakeAuthAdmin),
        "forbidden",
      );
    });

    it("tidak bisa mengubah akses akun sendiri", async () => {
      await expectAccessError(
        setUserActive(ctx.db, superA.current, { userId: superA.id, isActive: false }, ctxAudit, fakeAuthAdmin),
        "forbidden",
      );
    });

    it("manager outlet dengan user.manage hanya bisa memberi role yang permission-nya ia punya", async () => {
      await setRolePermission(ctx.db, superA.current, {
        roleId: A.roleId("manager"),
        permissionCode: "user.manage",
        granted: true,
      }, ctxAudit);
      const manager = await managerA.load();

      // Super Admin punya permission yang tidak dimiliki manager → ditolak.
      await expectAccessError(
        assignRole(ctx.db, manager, {
          userId: cashierA.id,
          roleId: A.roleId("super_admin"),
          outletId: A.outletId,
        }, ctxAudit),
        "forbidden",
      );
      // Scope company-wide padahal grant manager hanya outlet → ditolak.
      await expectAccessError(
        assignRole(ctx.db, manager, {
          userId: cashierA.id,
          roleId: A.roleId("barista"),
          outletId: null,
        }, ctxAudit),
        "forbidden",
      );
      // Barista di outlet sendiri → diizinkan.
      await assignRole(ctx.db, manager, {
        userId: cashierA.id,
        roleId: A.roleId("barista"),
        outletId: A.outletId,
      }, ctxAudit);
      expect(await ctx.countAudit(A.id, "rbac.role_assigned", cashierA.id)).toBe(1);
    });

    it("input tidak valid ditolak oleh validasi Zod", async () => {
      await expectAccessError(
        assignRole(ctx.db, superA.current, { userId: "bukan-uuid", roleId: A.roleId("barista"), outletId: null }, ctxAudit),
        "invalid",
      );
    });

    it("Super Admin terakhir tidak bisa dicabut", async () => {
      // Buat role kustom dengan semua permission untuk actor non-super-admin.
      const [custom] = await ctx.db
        .insert(roles)
        .values({ companyId: A.id, code: "custom_all", name: "Custom All" })
        .returning({ id: roles.id });
      await ctx.db
        .insert(rolePermissions)
        .values(PERMISSION_CODES.map((permissionCode) => ({ roleId: custom.id, permissionCode })));
      const helper = await ctx.createUser(A, []);
      await ctx.db.insert(userRoles).values({ userId: helper.id, roleId: custom.id });

      const [superGrant] = await ctx.db
        .select({ id: userRoles.id })
        .from(userRoles)
        .where(and(eq(userRoles.userId, superA.id), eq(userRoles.roleId, A.roleId("super_admin"))));
      await expectAccessError(
        revokeRole(ctx.db, await helper.load(), { userRoleId: superGrant.id }, ctxAudit),
        "conflict",
      );

      // Role yang dipegang sendiri tidak bisa diubah permission-nya.
      await expectAccessError(
        setRolePermission(ctx.db, await helper.load(), {
          roleId: custom.id,
          permissionCode: "kds.view",
          granted: false,
        }, ctxAudit),
        "forbidden",
      );
    });
  });

  describe("perubahan status & permission tercatat di audit log", () => {
    it("menonaktifkan & mengaktifkan user", async () => {
      await setUserActive(ctx.db, superA.current, { userId: baristaA.id, isActive: false, reason: "test" }, ctxAudit, fakeAuthAdmin);
      const [row] = await ctx.db.select({ isActive: users.isActive }).from(users).where(eq(users.id, baristaA.id));
      expect(row.isActive).toBe(false);
      expect(fakeAuthAdmin.setBanned).toHaveBeenCalledWith(baristaA.id, true);

      await setUserActive(ctx.db, superA.current, { userId: baristaA.id, isActive: true }, ctxAudit, fakeAuthAdmin);
      expect(await ctx.countAudit(A.id, "user.status_changed", baristaA.id)).toBe(2);
    });

    it("permission Super Admin terkunci", async () => {
      await expectAccessError(
        setRolePermission(ctx.db, superA.current, {
          roleId: A.roleId("super_admin"),
          permissionCode: "kds.view",
          granted: false,
        }, ctxAudit),
        "forbidden",
      );
    });

    it("grant & revoke permission role", async () => {
      const input = { roleId: A.roleId("cashier"), permissionCode: "kds.view" };
      await setRolePermission(ctx.db, superA.current, { ...input, granted: true }, ctxAudit);
      await setRolePermission(ctx.db, superA.current, { ...input, granted: false }, ctxAudit);
      expect(await ctx.countAudit(A.id, "rbac.permission_granted")).toBeGreaterThanOrEqual(1);
      expect(await ctx.countAudit(A.id, "rbac.permission_revoked")).toBe(1);
    });
  });

  describe("undang staf (Supabase Auth Admin sungguhan)", () => {
    it("membuat undangan, menghubungkan role, dan menolak email duplikat", async () => {
      const email = ctx.newEmail();
      const input = { email, fullName: "Staf Undangan", roleId: A.roleId("barista"), outletId: A.outletId };

      const result = await inviteStaff(ctx.db, superA.current, input, ctxAudit, supabaseAuthAdmin);
      expect(result.status).toBe("invited");
      if (result.status === "invited") expect(result.hashedToken.length).toBeGreaterThan(10);

      const [created] = await ctx.db.select().from(users).where(eq(users.id, result.userId));
      expect(created.companyId).toBe(A.id);
      expect(await ctx.countAudit(A.id, "user.invited", result.userId)).toBe(1);

      await expectAccessError(
        inviteStaff(ctx.db, superA.current, input, ctxAudit, supabaseAuthAdmin),
        "conflict",
      );
    });

    it("barista tidak bisa mengundang staf", async () => {
      await expectAccessError(
        inviteStaff(ctx.db, baristaA.current, {
          email: ctx.newEmail(),
          fullName: "Staf Baru",
          roleId: A.roleId("barista"),
          outletId: A.outletId,
        }, ctxAudit, supabaseAuthAdmin),
        "forbidden",
      );
    });

    it("ban/unban di Supabase Auth berjalan", async () => {
      await expect(supabaseAuthAdmin.setBanned(cashierA.id, true)).resolves.toBeUndefined();
      await expect(supabaseAuthAdmin.setBanned(cashierA.id, false)).resolves.toBeUndefined();
    });
  });
});
