import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Token akses guest untuk halaman status order. Diperlakukan seperti
// password: hanya hash yang disimpan, token asli hanya di cookie httpOnly.

export function hashAccessToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createAccessToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashAccessToken(token) };
}

export function verifyAccessToken(token: string | undefined, hash: string | null) {
  if (!token || !hash || token.length > 100) return false;
  const a = Buffer.from(hashAccessToken(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Cookie per order, hanya dikirim ke halaman status. */
export const orderCookieName = (orderId: string) => `sdy_order_${orderId.replace(/-/g, "")}`;
export const ORDER_COOKIE_PATH = "/order/status";
export const ORDER_COOKIE_MAX_AGE = 60 * 60 * 24 * 3;
