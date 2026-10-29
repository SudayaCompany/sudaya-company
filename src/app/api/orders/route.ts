// Checkout guest (QR, website, kiosk) — Route Handler, bukan Server Action,
// supaya bisa menjawab HTTP 429 + Retry-After saat rate limit tercapai.
// Order tetap dibuat oleh order engine yang sama dengan POS.

import type { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { AccessError } from "@/lib/auth/errors";
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE,
  checkoutRules,
  isCheckoutReplay,
  newDeviceId,
  readDeviceId,
} from "@/lib/orders/checkout-limits";
import { createOrder } from "@/lib/orders/engine";
import type { PlaceOrderResult } from "@/lib/orders/place-order";
import { PUBLIC_CHANNELS } from "@/lib/orders/schemas";
import { ORDER_COOKIE_MAX_AGE, ORDER_COOKIE_PATH, orderCookieName } from "@/lib/orders/tokens";
import { trustedClientIp } from "@/lib/security/client-ip";
import { consumeRateLimits } from "@/lib/security/rate-limit";

const MAX_BODY_BYTES = 64 * 1024;

const placeOrderInput = z.object({
  outlet: z.string().trim().min(1).max(32),
  channel: z.enum(PUBLIC_CHANNELS),
  checkout: z.record(z.string(), z.unknown()),
});

function json(body: PlaceOrderResult, status: number, headers?: Headers) {
  // Salin ke Headers baru: spread objek Headers tidak menyalin isinya (Set-Cookie hilang).
  const out = new Headers(headers);
  out.set("Cache-Control", "no-store");
  return Response.json(body, { status, headers: out });
}

/** Tolak request lintas-origin (defense-in-depth; JSON sudah memaksa preflight CORS). */
function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return json({ ok: false, error: "Permintaan ditolak." }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ ok: false, error: "Permintaan tidak valid." }, 415);
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ ok: false, error: "Pesanan terlalu besar." }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "Permintaan tidak valid. Muat ulang halaman." }, 400);
  }
  const parsed = placeOrderInput.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "Permintaan tidak valid. Muat ulang halaman." }, 400);
  }
  const { outlet, channel, checkout } = parsed.data;

  const existingDevice = readDeviceId(request.cookies.get(DEVICE_COOKIE)?.value);
  const deviceId = existingDevice ?? newDeviceId();
  const ip = trustedClientIp(request.headers);
  const secure = process.env.NODE_ENV === "production";
  const cookieHeaders = new Headers();
  if (!existingDevice) {
    cookieHeaders.append(
      "Set-Cookie",
      `${DEVICE_COOKIE}=${deviceId}; Path=/; Max-Age=${DEVICE_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
    );
  }

  try {
    const replay = await isCheckoutReplay(db, outlet, checkout.idempotencyKey);
    const limit = await consumeRateLimits(db, checkoutRules({ channel, outletCode: outlet, deviceId, ip, replay }));
    if (!limit.ok) {
      cookieHeaders.set("Retry-After", String(limit.retryAfterSeconds));
      const minutes = Math.ceil(limit.retryAfterSeconds / 60);
      return json(
        {
          ok: false,
          error: `Terlalu banyak pesanan dari perangkat/jaringan ini. Coba lagi dalam ${minutes} menit atau pesan di kasir.`,
          retryAfter: limit.retryAfterSeconds,
        },
        429,
        cookieHeaders,
      );
    }

    const created = await createOrder(
      db,
      { channel, outlet: { code: outlet }, actor: null, input: checkout },
      { ip, userAgent: request.headers.get("user-agent") },
    );

    // Token akses halaman status: cookie httpOnly, hanya untuk path status.
    // Kiosk adalah perangkat bersama → tidak menyimpan token.
    if (created.accessToken && channel !== "kiosk") {
      cookieHeaders.append(
        "Set-Cookie",
        `${orderCookieName(created.orderId)}=${created.accessToken}; Path=${ORDER_COOKIE_PATH}; Max-Age=${ORDER_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
      );
    }
    return json(
      { ok: true, orderId: created.orderId, reference: created.reference, total: created.total },
      created.replayed ? 200 : 201,
      cookieHeaders,
    );
  } catch (error) {
    if (error instanceof AccessError) {
      return json({ ok: false, error: error.message }, error.code === "conflict" ? 409 : 422, cookieHeaders);
    }
    console.error("[order] checkout gagal:", error instanceof Error ? error.message : error);
    return json({ ok: false, error: "Pesanan gagal dikirim. Coba lagi." }, 500, cookieHeaders);
  }
}
