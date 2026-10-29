import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { AuthAdmin } from "@/lib/auth/admin-ops";
import { getPublicEnv } from "@/lib/env";

/** Supabase client dengan service role — melewati RLS. Server only. */
function createAdminClient() {
  const serviceRoleKey = z
    .string({ error: "SUPABASE_SERVICE_ROLE_KEY belum di-set" })
    .min(1)
    .parse(process.env.SUPABASE_SERVICE_ROLE_KEY);

  return createClient(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Durasi ban "selamanya" versi Supabase Auth (100 tahun).
const BAN_FOREVER = "876000h";

export const supabaseAuthAdmin: AuthAdmin = {
  async createInvite(email, fullName) {
    const { data, error } = await createAdminClient().auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: { full_name: fullName } },
    });
    if (error || !data.user) {
      throw new Error(`Gagal membuat undangan: ${error?.message ?? "unknown"}`);
    }
    return { userId: data.user.id, hashedToken: data.properties.hashed_token };
  },

  async setBanned(userId, banned) {
    const { error } = await createAdminClient().auth.admin.updateUserById(userId, {
      ban_duration: banned ? BAN_FOREVER : "none",
    });
    if (error) throw error;
  },
};
