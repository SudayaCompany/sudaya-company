import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CODES,
  ROLE_CODES,
  type Permission,
} from "@/lib/auth/rbac";

const roleHas = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS, p: Permission) =>
  DEFAULT_ROLE_PERMISSIONS[role].includes(p);

describe("katalog RBAC", () => {
  it("memuat 41 permission unik dengan format domain.aksi", () => {
    expect(PERMISSION_CODES).toHaveLength(41);
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
    for (const code of PERMISSION_CODES) expect(code).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it("memuat 6 role internal (customer tidak memakai RBAC)", () => {
    expect(ROLE_CODES).toEqual([
      "super_admin",
      "owner",
      "manager",
      "admin",
      "barista",
      "cashier",
    ]);
  });

  it("mapping default hanya merujuk permission yang ada, tanpa duplikat", () => {
    for (const permissions of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      expect(new Set(permissions).size).toBe(permissions.length);
      for (const p of permissions) expect(PERMISSION_CODES).toContain(p);
    }
  });

  it("izin administrasi sistem hanya untuk Super Admin", () => {
    for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS) as (keyof typeof DEFAULT_ROLE_PERMISSIONS)[]) {
      expect(roleHas(role, "user.manage")).toBe(false);
      expect(roleHas(role, "role.manage")).toBe(false);
      expect(roleHas(role, "settings.manage")).toBe(false);
    }
  });

  it("owner: akses bisnis & laporan, bukan operasi kasir", () => {
    expect(roleHas("owner", "dashboard.view")).toBe(true);
    expect(roleHas("owner", "report.sales")).toBe(true);
    expect(roleHas("owner", "approval.approve")).toBe(true);
    expect(roleHas("owner", "payment.confirm_cash")).toBe(false);
    expect(roleHas("owner", "cash.open")).toBe(false);
  });

  it("manager: operasional outlet + approval", () => {
    for (const p of ["approval.approve", "inventory.adjust", "cash.close", "kds.manage"] as const) {
      expect(roleHas("manager", p)).toBe(true);
    }
    expect(roleHas("manager", "audit.view")).toBe(false);
  });

  it("barista: absensi, order, KDS, stok terbatas — tanpa kas/approval/admin", () => {
    for (const p of ["attendance.checkin", "order.create", "kds.view", "inventory.view"] as const) {
      expect(roleHas("barista", p)).toBe(true);
    }
    for (const p of [
      "dashboard.view",
      "payment.confirm_cash",
      "cash.open",
      "kds.manage",
      "approval.approve",
      "inventory.adjust",
    ] as const) {
      expect(roleHas("barista", p)).toBe(false);
    }
  });

  it("kasir: POS, pembayaran, sesi kas — tanpa KDS", () => {
    for (const p of ["order.create", "payment.confirm_cash", "cash.open", "cash.close"] as const) {
      expect(roleHas("cashier", p)).toBe(true);
    }
    expect(roleHas("cashier", "kds.view")).toBe(false);
    expect(roleHas("cashier", "dashboard.view")).toBe(false);
  });

  it("setiap role selain Super Admin adalah subset sejati dari semua permission", () => {
    for (const permissions of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      expect(permissions.length).toBeLessThan(PERMISSION_CODES.length);
    }
  });
});
