import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { safeNextPath } from "@/lib/auth/policy";
import { createClient } from "@/lib/supabase/server";

const otpType = z.enum(["invite", "recovery", "email"]) satisfies z.ZodType<EmailOtpType>;

/** Tujuan yang diizinkan setelah verifikasi link (anti open redirect). */
function destination(raw: string | null) {
  if (raw === "/auth/set-password") return raw;
  return safeNextPath(raw) ?? "/login";
}

/** Menukar token dari link undangan/reset password menjadi session. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = otpType.safeParse(searchParams.get("type"));

  if (tokenHash && type.success) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: type.data,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(
        new URL(destination(searchParams.get("next")), request.url),
      );
    }
  }

  return NextResponse.redirect(new URL("/login?error=link", request.url));
}
