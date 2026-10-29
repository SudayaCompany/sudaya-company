import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicEnv } from "@/lib/env";

/** Area internal yang wajib login. Customer (/order, /kiosk) tetap boleh guest. */
const PROTECTED_PREFIXES = ["/admin", "/staff", "/pos", "/kds", "/auth/set-password"];

/**
 * Me-refresh cookie session Supabase di setiap request, lalu melakukan
 * pengecekan optimistis untuk area internal.
 *
 * Ini BUKAN otorisasi utama — permission (RBAC) tetap dicek di server,
 * dekat ke data, di setiap Server Action / Route Handler.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = getPublicEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          // Cegah CDN meng-cache response yang membawa token session.
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  // Jangan taruh kode apa pun di antara createServerClient dan getClaims:
  // getClaims yang memicu refresh token.
  const { data } = await supabase.auth.getClaims();

  const { pathname, search } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !data?.claims) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    // Divalidasi ulang dengan safeNextPath saat login (anti open redirect).
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
