"use server";

import { refresh, updateTag } from "next/cache";

import { db } from "@/db";
import { AccessError, type ActionResult } from "@/lib/auth/errors";
import { runAction } from "@/lib/auth/run-action";
import { getAuditContext, requireActionUser } from "@/lib/auth/session";
import { catalogTag } from "@/lib/catalog/cache";
import { inventoryEvidenceStorage } from "@/lib/supabase/storage";

import { readEvidencePhoto } from "./evidence";
import {
  cancelOpname,
  createItem,
  createOpname,
  decideStockApproval,
  recordStockIn,
  recordStockOut,
  requestAdjustment,
  requestReversal,
  saveOpnameCounts,
  setItemProducts,
  setOpeningBalance,
  submitOpname,
  updateItem,
} from "./ops";
import { formatQty } from "./units";

// Server Action inventory. Actor selalu dari session; permission, scope
// outlet, konversi satuan, dan saldo divalidasi ulang di lib/inventory/ops.
// Browser tidak pernah mengirim saldo — hanya jumlah perubahan.

/** Sold out menu berubah (stok produk jadi melewati 0) → refresh katalog customer. */
function refreshMenu(brandId: string | null | undefined) {
  if (brandId) updateTag(catalogTag(brandId));
}

export async function createItemAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const created = await createItem(db, await requireActionUser(), input, await getAuditContext());
    refresh();
    return { ok: true, data: created, message: "Item stok dibuat." };
  });
}

export async function updateItemAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const result = await updateItem(db, await requireActionUser(), input, await getAuditContext());
    refreshMenu(result.menuBrandId);
    refresh();
    return { ok: true, message: "Item stok diperbarui." };
  });
}

export async function setItemProductsAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const result = await setItemProducts(db, await requireActionUser(), input, await getAuditContext());
    refreshMenu(result.menuBrandId);
    refresh();
    return { ok: true, message: "Hubungan menu diperbarui." };
  });
}

export async function setOpeningBalanceAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const result = await setOpeningBalance(db, await requireActionUser(), input, await getAuditContext());
    refreshMenu(result.menuBrandId);
    refresh();
    return { ok: true, message: `Saldo awal tercatat: ${formatQty(result.balance, result.unit)}.` };
  });
}

export async function stockInAction(input: unknown): Promise<ActionResult<{ balance: string }>> {
  return runAction(async () => {
    const result = await recordStockIn(db, await requireActionUser(), input, await getAuditContext());
    refreshMenu(result.menuBrandId);
    refresh();
    return {
      ok: true,
      data: { balance: result.balance },
      message: result.replayed
        ? "Sudah tercatat sebelumnya."
        : `Stok masuk tercatat. Saldo: ${formatQty(result.balance, result.unit)}.`,
    };
  });
}

/** FormData: field stok keluar + `photo` (opsional, bukti). */
export async function stockOutAction(form: FormData): Promise<ActionResult<{ balance: string }>> {
  return runAction(async () => {
    const actor = await requireActionUser();
    if (!(form instanceof FormData)) throw new AccessError("invalid", "Data tidak valid.");
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : undefined;
    };
    const photo = await readEvidencePhoto(form.get("photo"));
    const result = await recordStockOut(
      db,
      actor,
      {
        idempotencyKey: text("idempotencyKey"),
        itemId: text("itemId"),
        reason: text("reason"),
        quantity: text("quantity"),
        unit: text("unit"),
        notes: text("notes"),
      },
      photo,
      inventoryEvidenceStorage,
      await getAuditContext(),
    );
    refreshMenu(result.menuBrandId);
    refresh();
    return {
      ok: true,
      data: { balance: result.balance },
      message: result.replayed
        ? "Sudah tercatat sebelumnya."
        : `Tercatat. Saldo: ${formatQty(result.balance, result.unit)}.`,
    };
  });
}

export async function requestAdjustmentAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    await requestAdjustment(db, await requireActionUser(), input, await getAuditContext());
    refresh();
    return { ok: true, message: "Koreksi diajukan. Stok berubah setelah disetujui Manager." };
  });
}

export async function requestReversalAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    await requestReversal(db, await requireActionUser(), input, await getAuditContext());
    refresh();
    return { ok: true, message: "Reversal diajukan. Stok berubah setelah disetujui Manager." };
  });
}

export async function decideStockApprovalAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const result = await decideStockApproval(db, await requireActionUser(), input, await getAuditContext());
    refreshMenu(result.menuBrandId);
    refresh();
    return {
      ok: true,
      message: result.approved ? "Disetujui; stok sudah diperbarui." : "Pengajuan ditolak; stok tidak berubah.",
    };
  });
}

export async function createOpnameAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const created = await createOpname(db, await requireActionUser(), input, await getAuditContext());
    refresh();
    return { ok: true, data: { id: created.id }, message: `Opname dibuat (${created.items} item).` };
  });
}

export async function saveOpnameCountsAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const result = await saveOpnameCounts(db, await requireActionUser(), input, await getAuditContext());
    refresh();
    return { ok: true, message: `Hitungan tersimpan (${result.counted} item).` };
  });
}

export async function submitOpnameAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const result = await submitOpname(db, await requireActionUser(), input, await getAuditContext());
    refresh();
    return {
      ok: true,
      message:
        result.status === "applied"
          ? "Tidak ada selisih — opname selesai tanpa perubahan stok."
          : "Opname diajukan. Selisih diposting setelah disetujui Manager.",
    };
  });
}

export async function cancelOpnameAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    await cancelOpname(db, await requireActionUser(), input, await getAuditContext());
    refresh();
    return { ok: true, message: "Opname dibatalkan." };
  });
}
