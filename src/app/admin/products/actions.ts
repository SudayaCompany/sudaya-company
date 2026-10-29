"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db";
import type { ActionResult } from "@/lib/auth/errors";
import { runAction } from "@/lib/auth/run-action";
import { getAuditContext, requireActionUser } from "@/lib/auth/session";
import {
  createProduct,
  deleteProduct,
  resolveCatalogScope,
  setProductActive,
  setProductAvailability,
  updateProduct,
} from "@/lib/catalog/admin-ops";
import { catalogTag } from "@/lib/catalog/cache";
import { readMenuImage } from "@/lib/catalog/images";
import { productFormValues } from "@/lib/catalog/schemas";
import { menuImageStorage } from "@/lib/supabase/storage";

// Semua input divalidasi ulang di lib/catalog/admin-ops; actor selalu dari
// session. Field yang tidak dikenal di FormData diabaikan.

export type ProductFormState = { error?: string };

export async function saveProductAction(
  _prev: ProductFormState,
  form: FormData,
): Promise<ProductFormState> {
  const result = await runAction(async () => {
    const actor = await requireActionUser();
    const values = productFormValues(form);
    const image = await readMenuImage(form.get("image"));
    const productId = form.get("productId");
    const context = await getAuditContext();

    const saved =
      typeof productId === "string" && productId
        ? await updateProduct(
            db,
            actor,
            productId,
            values,
            { image, remove: form.get("removeImage") === "1" },
            context,
            menuImageStorage,
          )
        : await createProduct(
            db,
            actor,
            (await resolveCatalogScope(db, actor, String(form.get("brandId") ?? ""))).brand.id,
            values,
            image,
            context,
            menuImageStorage,
          );
    updateTag(catalogTag(saved.brandId));
    return { ok: true };
  });

  if (!result.ok) return { error: result.error };
  redirect("/admin/products?saved=1");
}

async function mutate(fn: () => Promise<{ brandId: string }>, message: string) {
  return runAction<undefined>(async () => {
    const { brandId } = await fn();
    updateTag(catalogTag(brandId));
    refresh();
    return { ok: true, message };
  });
}

export async function setProductActiveAction(input: unknown): Promise<ActionResult> {
  return mutate(
    async () => setProductActive(db, await requireActionUser(), input, await getAuditContext()),
    "Status produk diperbarui.",
  );
}

export async function setProductAvailabilityAction(input: unknown): Promise<ActionResult> {
  return mutate(
    async () =>
      setProductAvailability(db, await requireActionUser(), input, await getAuditContext()),
    "Ketersediaan diperbarui.",
  );
}

export async function deleteProductAction(productId: unknown): Promise<ActionResult> {
  return mutate(
    async () =>
      deleteProduct(db, await requireActionUser(), String(productId), await getAuditContext()),
    "Produk dihapus.",
  );
}
