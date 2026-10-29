"use server";

import { refresh } from "next/cache";

import { db } from "@/db";
import { setRolePermission } from "@/lib/auth/admin-ops";
import type { ActionResult } from "@/lib/auth/errors";
import { runAction } from "@/lib/auth/run-action";
import { getAuditContext, requireActionUser } from "@/lib/auth/session";

export async function setRolePermissionAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActionUser();
    await setRolePermission(db, actor, input, await getAuditContext());
    refresh();
    return { ok: true, message: "Permission diperbarui." };
  });
}
