"use server";

import { refresh, updateTag } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import type { ActionResult } from "@/lib/auth/errors";
import { runAction } from "@/lib/auth/run-action";
import { getAuditContext, requireActionUser } from "@/lib/auth/session";
import { createCategory, deleteCategory, updateCategory } from "@/lib/catalog/admin-ops";
import { catalogTag } from "@/lib/catalog/cache";

// Hanya id target yang diambil di sini; isi data divalidasi categoryInput.
const target = z.object({ id: z.string(), values: z.unknown() });

async function mutate(fn: () => Promise<{ brandId: string } | undefined>, message: string) {
  return runAction<undefined>(async () => {
    const result = await fn();
    if (result) updateTag(catalogTag(result.brandId));
    refresh();
    return { ok: true, message };
  });
}

export async function createCategoryAction(input: unknown): Promise<ActionResult> {
  return mutate(async () => {
    const { id: brandId, values } = target.parse(input);
    return createCategory(db, await requireActionUser(), brandId, values, await getAuditContext());
  }, "Kategori ditambahkan.");
}

export async function updateCategoryAction(input: unknown): Promise<ActionResult> {
  return mutate(async () => {
    const { id, values } = target.parse(input);
    return updateCategory(db, await requireActionUser(), id, values, await getAuditContext());
  }, "Kategori disimpan.");
}

export async function deleteCategoryAction(categoryId: unknown): Promise<ActionResult> {
  return mutate(
    async () =>
      deleteCategory(db, await requireActionUser(), String(categoryId), await getAuditContext()),
    "Kategori dihapus.",
  );
}
