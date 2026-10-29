"use server";

import { refresh, updateTag } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import type { ActionResult } from "@/lib/auth/errors";
import { runAction } from "@/lib/auth/run-action";
import { getAuditContext, requireActionUser } from "@/lib/auth/session";
import {
  createModifierGroup,
  deleteModifierGroup,
  updateModifierGroup,
} from "@/lib/catalog/admin-ops";
import { catalogTag } from "@/lib/catalog/cache";

// Isi grup divalidasi modifierGroupInput di admin-ops.
const target = z.object({ id: z.string(), values: z.unknown() });

async function mutate(fn: () => Promise<{ brandId: string }>, message: string) {
  return runAction<undefined>(async () => {
    const { brandId } = await fn();
    updateTag(catalogTag(brandId));
    refresh();
    return { ok: true, message };
  });
}

export async function createModifierGroupAction(input: unknown): Promise<ActionResult> {
  return mutate(async () => {
    const { id: brandId, values } = target.parse(input);
    return createModifierGroup(db, await requireActionUser(), brandId, values, await getAuditContext());
  }, "Grup modifier dibuat.");
}

export async function updateModifierGroupAction(input: unknown): Promise<ActionResult> {
  return mutate(async () => {
    const { id, values } = target.parse(input);
    return updateModifierGroup(db, await requireActionUser(), id, values, await getAuditContext());
  }, "Grup modifier disimpan.");
}

export async function deleteModifierGroupAction(groupId: unknown): Promise<ActionResult> {
  return mutate(
    async () =>
      deleteModifierGroup(db, await requireActionUser(), String(groupId), await getAuditContext()),
    "Grup modifier dihapus.",
  );
}
