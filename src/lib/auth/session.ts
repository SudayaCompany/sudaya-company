import "server-only";

import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { db } from "@/db";
import type { AuditContext } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";

import { isSessionActive, loadCurrentUser, type CurrentUser } from "./access";
import { AccessError } from "./errors";
import { hasAnyPermission, hasPermission, type AccessScope } from "./policy";
import type { Permission } from "./rbac";

/**
 * Data Access Layer (DAL) auth. Semua halaman, Server Action, dan Route
 * Handler internal wajib lewat fungsi di sini — proxy hanya pengecekan awal.
 */

/**
 * Session aktif: JWT terverifikasi (getClaims memeriksa signature & exp)
 * DAN session belum dicabut di auth.sessions (logout / revoke).
 */
export const getSession = cache(
  async (): Promise<{ userId: string; sessionId: string } | null> => {
    // Auth hanya boleh dievaluasi saat ada request sungguhan. Tanpa ini,
    // prerender runtime Cache Components (cookies sudah tersedia) ikut
    // menjalankan getClaims(), yang memanggil Date.now() untuk cek exp JWT,
    // dan Next melaporkan "unstable value Date.now() while prerendering".
    await connection();
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (error || !claims?.sub || typeof claims.session_id !== "string") {
      return null;
    }
    if (!(await isSessionActive(db, claims.session_id, claims.sub))) return null;
    return { userId: claims.sub, sessionId: claims.session_id };
  },
);

export const getSessionUserId = cache(
  async (): Promise<string | null> => (await getSession())?.userId ?? null,
);

/** User aplikasi + role/permission. null jika belum login atau bukan staf. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const userId = await getSessionUserId();
  if (!userId) return null;
  return loadCurrentUser(db, userId);
});

/** Untuk halaman: redirect ke /login jika belum login, nonaktif, atau bukan staf. */
export async function requireAuth(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  // /login menampilkan alasan (nonaktif / belum terdaftar) tanpa redirect loop.
  if (!user || !user.isActive) redirect("/login");
  return user;
}

/** Untuk halaman: tampilkan 403 jika permission tidak dimiliki. */
export async function requirePermission(
  permission: Permission,
  scope?: AccessScope,
): Promise<CurrentUser> {
  const user = await requireAuth();
  if (!hasPermission(user, permission, scope)) forbidden();
  return user;
}

export async function requireAnyPermission(
  permissions: readonly Permission[],
  scope?: AccessScope,
): Promise<CurrentUser> {
  const user = await requireAuth();
  if (!hasAnyPermission(user, permissions, scope)) forbidden();
  return user;
}

/**
 * Untuk Server Action: melempar AccessError (bukan redirect) agar action
 * bisa mengembalikan pesan error. Tetap dipanggil ulang di setiap action
 * walau halaman sudah dicek, karena action bisa dipanggil langsung.
 */
export async function requireActionUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || !user.isActive) {
    throw new AccessError("unauthenticated", "Sesi berakhir. Silakan login ulang.");
  }
  return user;
}

/** IP & user agent untuk audit log. Tidak pernah membaca cookie/token. */
export async function getAuditContext(): Promise<AuditContext> {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
    userAgent: h.get("user-agent"),
  };
}
