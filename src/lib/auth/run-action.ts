import "server-only";

import { unstable_rethrow } from "next/navigation";

import { AccessError, type ActionResult } from "./errors";

/**
 * Membungkus isi Server Action: AccessError → pesan untuk user, error lain
 * → pesan generik (detail hanya di log server, tanpa data sensitif).
 */
export async function runAction<T>(
  fn: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    // Biarkan redirect()/forbidden() dari Next.js lewat.
    unstable_rethrow(error);
    if (error instanceof AccessError) return { ok: false, error: error.message };
    console.error("[action] unexpected error:", error instanceof Error ? error.message : error);
    return { ok: false, error: "Terjadi kesalahan. Coba lagi." };
  }
}
