// Batas checkout guest (QR, website, kiosk). Dua lapis:
// - per perangkat (cookie acak sdy_did): ketat, untuk 1 HP customer;
// - per IP tepercaya: longgar, karena banyak customer sah berbagi Wi-Fi outlet.
// Bot yang membuang cookie tetap tertahan batas IP. Retry dengan idempotency
// key yang sama (order sudah ada) tidak memakai kuota checkout.

import { randomBytes } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/client";
import { orders, outlets } from "@/db/schema";
import type { RateLimitRule } from "@/lib/security/rate-limit";

import type { OrderChannel } from "./state";

export const CHECKOUT_WINDOW_SECONDS = 10 * 60;

export const CHECKOUT_LIMITS = {
  /** Order baru per HP customer per 10 menit. */
  device: 6,
  /** Kiosk = satu perangkat dipakai bergantian banyak customer. */
  kioskDevice: 40,
  /** Order baru per IP per 10 menit (Wi-Fi outlet bersama). */
  ip: 60,
  /** Cadangan bila IP tidak diketahui (tanpa proxy tepercaya): per outlet. */
  unknownIpPerOutlet: 120,
  /** Retry (key sama) per IP / perangkat per 10 menit. */
  replay: 120,
} as const;

export const DEVICE_COOKIE = "sdy_did";
export const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;

export const readDeviceId = (value: string | undefined) =>
  value && DEVICE_ID.test(value) ? value : null;

export const newDeviceId = () => randomBytes(16).toString("base64url");

export function checkoutRules(params: {
  channel: OrderChannel;
  outletCode: string;
  deviceId: string;
  ip: string | null;
  replay: boolean;
}): RateLimitRule[] {
  const window = CHECKOUT_WINDOW_SECONDS;
  const outlet = params.outletCode.trim().toUpperCase();
  const network = params.ip ? `ip:${params.ip}` : `outlet:${outlet}`;
  if (params.replay) {
    return [
      { key: `checkout-replay:device:${params.deviceId}`, limit: CHECKOUT_LIMITS.replay, windowSeconds: window },
      { key: `checkout-replay:${network}`, limit: CHECKOUT_LIMITS.replay * 2, windowSeconds: window },
    ];
  }
  return [
    {
      key: `checkout:device:${params.deviceId}`,
      limit: params.channel === "kiosk" ? CHECKOUT_LIMITS.kioskDevice : CHECKOUT_LIMITS.device,
      windowSeconds: window,
    },
    {
      key: `checkout:${network}`,
      limit: params.ip ? CHECKOUT_LIMITS.ip : CHECKOUT_LIMITS.unknownIpPerOutlet,
      windowSeconds: window,
    },
  ];
}

/** true jika order dengan idempotency key ini sudah ada di outlet tsb. */
export async function isCheckoutReplay(db: DbExecutor, outletCode: string, idempotencyKey: unknown) {
  if (typeof idempotencyKey !== "string" || !/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return false;
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(orders)
    .innerJoin(outlets, eq(outlets.id, orders.outletId))
    .where(
      and(
        eq(outlets.code, outletCode.trim().toUpperCase()),
        eq(orders.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return Boolean(row);
}
