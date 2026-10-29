"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { loadCurrentUser } from "@/lib/auth/access";
import { postLoginPath } from "@/lib/auth/policy";
import { getAuditContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type LoginState = {
  error?: string;
  fieldErrors?: { email?: string; password?: string };
  email?: string;
};

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, { error: "Email wajib diisi." })
    .pipe(z.email({ error: "Format email tidak valid." })),
  password: z.string().min(1, { error: "Password wajib diisi." }).max(128),
  next: z.string().max(512).optional(),
});

function authErrorMessage(code: string | undefined) {
  switch (code) {
    case "invalid_credentials":
      return "Email atau password salah.";
    case "email_not_confirmed":
      return "Email belum dikonfirmasi. Buka link undangan yang Anda terima.";
    case "user_banned":
      return "Akun Anda dinonaktifkan. Hubungi admin.";
    case "over_request_rate_limit":
      return "Terlalu banyak percobaan login. Tunggu beberapa menit lalu coba lagi.";
    default:
      return "Login gagal. Periksa koneksi lalu coba lagi.";
  }
}

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || undefined,
  });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) {
    const fields = z.flattenError(parsed.error).fieldErrors;
    return {
      email,
      fieldErrors: { email: fields.email?.[0], password: fields.password?.[0] },
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error || !data.user) {
    return { email, error: authErrorMessage(error?.code) };
  }

  // Akun Supabase Auth valid, tapi wajib terdaftar & aktif sebagai staf.
  const user = await loadCurrentUser(db, data.user.id);
  const destination = user?.isActive ? postLoginPath(user, parsed.data.next) : null;
  if (!user || !user.isActive || !destination) {
    await supabase.auth.signOut({ scope: "local" });
    return {
      email,
      error: !user
        ? "Akun ini belum terdaftar sebagai staf Sudaya."
        : !user.isActive
          ? "Akun Anda dinonaktifkan. Hubungi admin."
          : "Akun Anda belum memiliki akses. Hubungi admin.",
    };
  }

  await recordAudit(
    db,
    {
      companyId: user.company.id,
      actorId: user.id,
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
    },
    await getAuditContext(),
  );

  redirect(destination);
}
