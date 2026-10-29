"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { db } from "@/db";
import {
  assignRole,
  inviteStaff,
  revokeRole,
  setUserActive,
} from "@/lib/auth/admin-ops";
import { AccessError, type ActionResult } from "@/lib/auth/errors";
import { runAction } from "@/lib/auth/run-action";
import { getAuditContext, requireActionUser } from "@/lib/auth/session";
import { supabaseAuthAdmin } from "@/lib/supabase/admin";

// Input bertipe unknown: semua divalidasi ulang dengan Zod di admin-ops,
// dan actor selalu diambil dari session — bukan dari request body.

export async function assignRoleAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActionUser();
    await assignRole(db, actor, input, await getAuditContext());
    refresh();
    return { ok: true, message: "Role ditambahkan." };
  });
}

export async function revokeRoleAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActionUser();
    await revokeRole(db, actor, input, await getAuditContext());
    refresh();
    return { ok: true, message: "Role dicabut." };
  });
}

export async function setUserActiveAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActionUser();
    const { warning } = await setUserActive(
      db,
      actor,
      input,
      await getAuditContext(),
      supabaseAuthAdmin,
    );
    refresh();
    return { ok: true, message: warning ?? "Status akun diperbarui." };
  });
}

export async function inviteStaffAction(
  input: unknown,
): Promise<ActionResult<{ inviteUrl?: string }>> {
  return runAction<{ inviteUrl?: string }>(async () => {
    const actor = await requireActionUser();
    // Origin sudah divalidasi Next.js untuk Server Action (cek CSRF).
    const origin = (await headers()).get("origin");
    if (!origin || !/^https?:\/\//.test(origin)) {
      throw new AccessError("invalid", "Origin request tidak valid.");
    }

    const result = await inviteStaff(
      db,
      actor,
      input,
      await getAuditContext(),
      supabaseAuthAdmin,
    );
    refresh();

    if (result.status === "linked") {
      return {
        ok: true,
        message:
          "Akun sudah ada di Supabase Auth dan langsung dihubungkan. Staf bisa login dengan password akunnya.",
        data: {},
      };
    }

    const inviteUrl = new URL("/auth/confirm", origin);
    inviteUrl.searchParams.set("token_hash", result.hashedToken);
    inviteUrl.searchParams.set("type", "invite");
    inviteUrl.searchParams.set("next", "/auth/set-password");
    return {
      ok: true,
      message: "Undangan dibuat.",
      data: { inviteUrl: inviteUrl.toString() },
    };
  });
}
