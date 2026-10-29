import type { AccessGrant } from "./policy";

/** Label scope grant, mis. "Semua outlet" atau nama outlet. */
export function scopeLabel(
  outletId: string | null,
  outletNames: ReadonlyMap<string, string>,
) {
  if (outletId === null) return "Semua outlet";
  return outletNames.get(outletId) ?? "Outlet lain";
}

/** Nama role unik milik user, untuk ditampilkan di header/dashboard. */
export function roleNames(grants: readonly AccessGrant[]) {
  return [...new Set(grants.map((grant) => grant.roleName))];
}
