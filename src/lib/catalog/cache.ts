import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { db } from "@/db";

import { loadDefaultOutletCode, loadStorefront } from "./storefront";

/** Tag cache katalog customer per brand; di-invalidate oleh aksi admin. */
export const catalogTag = (brandId: string) => `catalog:brand:${brandId}`;
export const OUTLETS_TAG = "catalog:outlets";

export async function getStorefront(outletCode: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(OUTLETS_TAG);
  const storefront = await loadStorefront(db, outletCode);
  if (storefront) cacheTag(catalogTag(storefront.brand.id));
  return storefront;
}

export async function getDefaultOutletCode() {
  "use cache";
  // Pendek: jumlah outlet aktif bisa berubah (outlet baru/nonaktif).
  cacheLife("minutes");
  cacheTag(OUTLETS_TAG);
  return loadDefaultOutletCode(db);
}
