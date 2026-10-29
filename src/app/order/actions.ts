"use server";

import { db } from "@/db";
import { cartQuoteInput, quoteCart, type CartQuote } from "@/lib/catalog/quote";
import { loadStorefront } from "@/lib/catalog/storefront";

/**
 * Hitung harga keranjang di server (publik, guest boleh). Memakai data
 * terbaru dari DB — bukan cache — supaya harga & sold out selalu akurat.
 */
export async function quoteCartAction(input: unknown): Promise<CartQuote> {
  const parsed = cartQuoteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Data keranjang tidak valid." };

  const storefront = await loadStorefront(db, parsed.data.outlet);
  if (!storefront) return { ok: false, error: "Outlet tidak ditemukan." };
  return quoteCart(storefront, parsed.data.lines);
}
