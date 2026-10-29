"use server";

import { headers } from "next/headers";

import { db } from "@/db";
import { cartQuoteInput, quoteCart, type CartQuote } from "@/lib/catalog/quote";
import { loadStorefront } from "@/lib/catalog/storefront";
import { trustedClientIp } from "@/lib/security/client-ip";
import { consumeRateLimits } from "@/lib/security/rate-limit";

/** Hitung ulang keranjang per IP per menit (dipanggil tiap isi keranjang berubah). */
const QUOTE_LIMIT_PER_MINUTE = 300;

/**
 * Hitung harga keranjang di server (publik, guest boleh). Memakai data
 * terbaru dari DB — bukan cache — supaya harga, sold out, & stok selalu akurat.
 *
 * Checkout guest ada di POST /api/orders (Route Handler) agar bisa menjawab
 * HTTP 429 saat rate limit tercapai.
 */
export async function quoteCartAction(input: unknown): Promise<CartQuote> {
  const parsed = cartQuoteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Data keranjang tidak valid." };

  const ip = trustedClientIp(await headers());
  if (ip) {
    const limit = await consumeRateLimits(db, [
      { key: `quote:ip:${ip}`, limit: QUOTE_LIMIT_PER_MINUTE, windowSeconds: 60 },
    ]);
    if (!limit.ok) return { ok: false, error: "Terlalu banyak permintaan. Coba lagi sebentar lagi." };
  }

  const storefront = await loadStorefront(db, parsed.data.outlet, { withStock: true });
  if (!storefront) return { ok: false, error: "Outlet tidak ditemukan." };
  return quoteCart(storefront, parsed.data.lines);
}
