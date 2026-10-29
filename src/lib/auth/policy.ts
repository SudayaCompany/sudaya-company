// Aturan otorisasi murni (tanpa I/O) supaya mudah dites dan dipakai ulang
// oleh DAL, Server Action, dan redirect setelah login.

import { STAFF_APP_PERMISSIONS, type Permission } from "./rbac";

export type AccessGrant = {
  userRoleId: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  /** null = berlaku di semua outlet milik company. */
  outletId: string | null;
  permissions: readonly string[];
};

export type AccessSubject = {
  grants: readonly AccessGrant[];
};

/**
 * Scope pengecekan:
 * - tidak diisi / `outletId: undefined` → di outlet mana pun
 * - `outletId: null` → harus berlaku company-wide
 * - `outletId: "<id>"` → berlaku di outlet tsb (grant company-wide ikut)
 */
export type AccessScope = { outletId?: string | null };

function grantCovers(grant: AccessGrant, scope?: AccessScope) {
  if (!scope || scope.outletId === undefined) return true;
  if (scope.outletId === null) return grant.outletId === null;
  return grant.outletId === null || grant.outletId === scope.outletId;
}

export function permissionSet(subject: AccessSubject, scope?: AccessScope) {
  const result = new Set<string>();
  for (const grant of subject.grants) {
    if (!grantCovers(grant, scope)) continue;
    for (const permission of grant.permissions) result.add(permission);
  }
  return result;
}

export function hasPermission(
  subject: AccessSubject,
  permission: Permission,
  scope?: AccessScope,
) {
  return subject.grants.some(
    (grant) =>
      grantCovers(grant, scope) && grant.permissions.includes(permission),
  );
}

export function hasAnyPermission(
  subject: AccessSubject,
  permissions: readonly Permission[],
  scope?: AccessScope,
) {
  return permissions.some((permission) =>
    hasPermission(subject, permission, scope),
  );
}

/** True jika actor memegang semua `required` pada scope tsb. */
export function coversPermissions(
  actor: AccessSubject,
  required: Iterable<string>,
  scope: AccessScope,
) {
  const held = permissionSet(actor, scope);
  for (const permission of required) {
    if (!held.has(permission)) return false;
  }
  return true;
}

/**
 * Anti privilege escalation: actor hanya boleh mengelola akun yang seluruh
 * permission-nya juga dimiliki actor pada scope operasi tsb
 * (default company-wide).
 */
export function dominates(
  actor: AccessSubject,
  target: AccessSubject,
  scope: AccessScope = { outletId: null },
) {
  return coversPermissions(actor, permissionSet(target), scope);
}

// --- Routing ----------------------------------------------------------------

/** Permission minimal (salah satu) untuk membuka tiap area internal. */
export const ROUTE_ACCESS = {
  "/admin/users": ["user.manage"],
  "/admin/roles": ["role.manage"],
  "/admin/audit": ["audit.view"],
  "/admin/products": ["product.view"],
  "/admin/categories": ["product.view"],
  "/admin/modifiers": ["product.view"],
  "/admin": ["dashboard.view"],
  "/staff": STAFF_APP_PERMISSIONS,
  "/kds": ["kds.view"],
} as const satisfies Record<string, readonly Permission[]>;

export type ProtectedRoute = keyof typeof ROUTE_ACCESS;

function matchRoute(pathname: string): ProtectedRoute | null {
  const routes = Object.keys(ROUTE_ACCESS) as ProtectedRoute[];
  // Prefix terpanjang menang (/admin/users sebelum /admin).
  const sorted = routes.sort((a, b) => b.length - a.length);
  return (
    sorted.find(
      (route) => pathname === route || pathname.startsWith(`${route}/`),
    ) ?? null
  );
}

export function canAccessPath(subject: AccessSubject, pathname: string) {
  const route = matchRoute(pathname);
  if (!route) return true;
  return hasAnyPermission(subject, ROUTE_ACCESS[route]);
}

/** Halaman awal sesuai akses yang benar-benar dimiliki; null = tanpa akses. */
export function landingPath(subject: AccessSubject): string | null {
  for (const route of ["/admin", "/staff", "/kds"] as const) {
    if (hasAnyPermission(subject, ROUTE_ACCESS[route])) return route;
  }
  return null;
}

const INTERNAL_ORIGIN = "http://sudaya.internal";

/**
 * Validasi parameter `next` agar tidak bisa dipakai untuk open redirect.
 * Hanya path relatif di origin sendiri yang diterima.
 */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) {
    return null;
  }
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw, INTERNAL_ORIGIN);
  } catch {
    return null;
  }
  // Parser URL menormalkan "\" dan karakter kontrol; kalau hasilnya pindah
  // origin, berarti input mencoba keluar domain.
  if (url.origin !== INTERNAL_ORIGIN) return null;
  if (url.pathname === "/login" || url.pathname.startsWith("/auth/")) {
    return null;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Tujuan setelah login: `next` jika aman & diizinkan, kalau tidak landing. */
export function postLoginPath(subject: AccessSubject, next: unknown) {
  const safe = safeNextPath(next);
  if (safe && canAccessPath(subject, new URL(safe, INTERNAL_ORIGIN).pathname)) {
    return safe;
  }
  return landingPath(subject);
}
