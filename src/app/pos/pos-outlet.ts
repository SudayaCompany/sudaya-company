import "server-only";

import { forbidden } from "next/navigation";

import { db } from "@/db";
import type { CurrentUser } from "@/lib/auth/access";
import type { Permission } from "@/lib/auth/rbac";
import { outletsWithPermission } from "@/lib/orders/engine";

/** Outlet aktif untuk halaman staf (?outlet=), hanya dari outlet yang diizinkan. */
export async function resolveStaffOutlet(
  actor: CurrentUser,
  permission: Permission,
  requested: string | undefined,
) {
  const outlets = await outletsWithPermission(db, actor, permission);
  if (outlets.length === 0) forbidden();
  const outlet = outlets.find((o) => o.id === requested) ?? outlets[0];
  return { outlets, outlet };
}
