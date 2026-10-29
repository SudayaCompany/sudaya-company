import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canAccessPath,
  dominates,
  hasPermission,
  landingPath,
  postLoginPath,
  safeNextPath,
  type AccessGrant,
  type AccessSubject,
} from "@/lib/auth/policy";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CODES,
  type RoleCode,
} from "@/lib/auth/rbac";

const OUTLET_A = randomUUID();
const OUTLET_B = randomUUID();

function grant(roleCode: RoleCode, outletId: string | null = null): AccessGrant {
  return {
    userRoleId: randomUUID(),
    roleId: randomUUID(),
    roleCode,
    roleName: roleCode,
    outletId,
    permissions:
      roleCode === "super_admin" ? PERMISSION_CODES : DEFAULT_ROLE_PERMISSIONS[roleCode],
  };
}

const subject = (...grants: AccessGrant[]): AccessSubject => ({ grants });

describe("hasPermission + scope outlet", () => {
  const baristaA = subject(grant("barista", OUTLET_A));

  it("grant outlet berlaku hanya di outlet tsb", () => {
    expect(hasPermission(baristaA, "order.create")).toBe(true);
    expect(hasPermission(baristaA, "order.create", { outletId: OUTLET_A })).toBe(true);
    expect(hasPermission(baristaA, "order.create", { outletId: OUTLET_B })).toBe(false);
  });

  it("grant outlet tidak memenuhi syarat company-wide", () => {
    expect(hasPermission(baristaA, "order.create", { outletId: null })).toBe(false);
  });

  it("grant company-wide berlaku di semua outlet", () => {
    const owner = subject(grant("owner"));
    expect(hasPermission(owner, "report.sales", { outletId: OUTLET_B })).toBe(true);
    expect(hasPermission(owner, "report.sales", { outletId: null })).toBe(true);
  });

  it("user tanpa grant tidak punya permission apa pun", () => {
    expect(hasPermission(subject(), "order.view")).toBe(false);
  });
});

describe("dominates (anti privilege escalation)", () => {
  it("super admin mendominasi semua role", () => {
    const superAdmin = subject(grant("super_admin"));
    expect(dominates(superAdmin, subject(grant("manager")))).toBe(true);
  });

  it("manager tidak mendominasi owner (owner punya audit.view)", () => {
    expect(dominates(subject(grant("manager")), subject(grant("owner")))).toBe(false);
  });

  it("manager outlet A mendominasi barista hanya pada scope outlet A", () => {
    const manager = subject(grant("manager", OUTLET_A));
    const barista = subject(grant("barista", OUTLET_A));
    expect(dominates(manager, barista, { outletId: OUTLET_A })).toBe(true);
    expect(dominates(manager, barista, { outletId: OUTLET_B })).toBe(false);
    expect(dominates(manager, barista)).toBe(false);
  });
});

describe("safeNextPath (anti open redirect)", () => {
  it.each([
    ["/admin", "/admin"],
    ["/admin/users?tab=1#top", "/admin/users?tab=1#top"],
    ["/staff", "/staff"],
  ])("menerima path internal %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    "//evil.com",
    "//evil.com/admin",
    "/\\evil.com",
    "/\\/evil.com",
    "/\t/evil.com",
    "https://evil.com",
    "http:/evil.com",
    "javascript:alert(1)",
    "evil.com",
    "",
    "/login",
    "/login?next=/admin",
    "/auth/confirm?token_hash=x",
    "/" + "a".repeat(600),
  ])("menolak %j", (input) => {
    expect(safeNextPath(input)).toBeNull();
  });

  it("menolak non-string", () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(["/admin"])).toBeNull();
  });
});

describe("routing berdasarkan akses", () => {
  const superAdmin = subject(grant("super_admin"));
  const owner = subject(grant("owner"));
  const barista = subject(grant("barista", OUTLET_A));
  const cashier = subject(grant("cashier", OUTLET_A));

  it("landing sesuai akses yang dimiliki", () => {
    expect(landingPath(superAdmin)).toBe("/admin");
    expect(landingPath(owner)).toBe("/admin");
    expect(landingPath(barista)).toBe("/staff");
    expect(landingPath(cashier)).toBe("/staff");
    expect(landingPath(subject())).toBeNull();
  });

  it("barista tidak bisa membuka area admin, bisa /staff & /kds", () => {
    expect(canAccessPath(barista, "/admin")).toBe(false);
    expect(canAccessPath(barista, "/admin/users")).toBe(false);
    expect(canAccessPath(barista, "/staff")).toBe(true);
    expect(canAccessPath(barista, "/kds")).toBe(true);
  });

  it("kasir tidak punya akses KDS", () => {
    expect(canAccessPath(cashier, "/kds")).toBe(false);
  });

  it("owner bisa dashboard & audit tapi tidak manajemen user/role", () => {
    expect(canAccessPath(owner, "/admin")).toBe(true);
    expect(canAccessPath(owner, "/admin/audit")).toBe(true);
    expect(canAccessPath(owner, "/admin/users")).toBe(false);
    expect(canAccessPath(owner, "/admin/roles")).toBe(false);
  });

  it("halaman katalog admin butuh product.view", () => {
    const manager = subject(grant("manager", OUTLET_A));
    for (const path of ["/admin/products", "/admin/products/new", "/admin/categories", "/admin/modifiers"]) {
      expect(canAccessPath(barista, path), path).toBe(false);
      expect(canAccessPath(cashier, path), path).toBe(false);
      expect(canAccessPath(manager, path), path).toBe(true);
      expect(canAccessPath(owner, path), path).toBe(true);
    }
  });

  it("postLoginPath memakai next hanya jika aman & diizinkan", () => {
    expect(postLoginPath(superAdmin, "/admin/users")).toBe("/admin/users");
    expect(postLoginPath(barista, "/admin")).toBe("/staff");
    expect(postLoginPath(barista, "//evil.com")).toBe("/staff");
    expect(postLoginPath(subject(), "/admin")).toBeNull();
  });
});
