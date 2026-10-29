"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { landingPath } from "@/lib/auth/policy";
import { getAuditContext, getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type SetPasswordState = { error?: string };

const MIN_LENGTH = 12;

const schema = z
  .object({
    password: z
      .string()
      .min(MIN_LENGTH, { error: `Password minimal ${MIN_LENGTH} karakter.` })
      .max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    error: "Konfirmasi password tidak sama.",
  });

export async function setPassword(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const user = await getCurrentUser();
  if (!user || !user.isActive) return { error: "Sesi berakhir. Buka ulang link undangan." };

  const parsed = schema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return {
      error:
        error.code === "weak_password"
          ? "Password terlalu lemah. Gunakan kombinasi huruf, angka, dan simbol."
          : error.code === "same_password"
            ? "Gunakan password yang berbeda dari sebelumnya."
            : "Gagal menyimpan password. Coba lagi.",
    };
  }

  await recordAudit(
    db,
    {
      companyId: user.company.id,
      actorId: user.id,
      action: "auth.password_set",
      entityType: "user",
      entityId: user.id,
    },
    await getAuditContext(),
  );

  redirect(landingPath(user) ?? "/login");
}
