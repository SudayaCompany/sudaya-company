"use server";

import { refresh, updateTag } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { AccessError, type ActionResult } from "@/lib/auth/errors";
import { hasPermission } from "@/lib/auth/policy";
import { runAction } from "@/lib/auth/run-action";
import { getAuditContext, requireActionUser } from "@/lib/auth/session";
import { catalogTag } from "@/lib/catalog/cache";
import { formatRupiah } from "@/lib/format";

import {
  cancelOrder,
  confirmCashPayment,
  createOrder,
  decideCancellation,
  updateOrderStatus,
} from "./engine";

// Server Action staf (POS, KDS, admin). Actor selalu dari session; seluruh
// validasi permission, scope, dan state machine ada di engine.

/** Stok produk jadi melewati 0 → katalog customer (cache) perlu dimuat ulang. */
function refreshMenu(brandId: string | null) {
  if (brandId) updateTag(catalogTag(brandId));
}

const posCheckoutInput = z.object({
  outletId: z.uuid(),
  checkout: z.unknown(),
  /** Diisi kasir bila uang tunai diterima saat itu juga. */
  tenderedAmount: z.number().int().min(0).max(100_000_000).nullable(),
});

export type PosCheckoutResult = {
  orderId: string;
  reference: string;
  total: number;
  orderNumber: string | null;
  change: number | null;
  warning?: string;
};

export async function posCheckoutAction(input: unknown): Promise<ActionResult<PosCheckoutResult>> {
  return runAction<PosCheckoutResult>(async () => {
    const actor = await requireActionUser();
    const parsed = posCheckoutInput.safeParse(input);
    if (!parsed.success) throw new AccessError("invalid", "Data transaksi tidak valid.");
    const context = await getAuditContext();

    const created = await createOrder(
      db,
      { channel: "pos", outlet: { id: parsed.data.outletId }, actor, input: parsed.data.checkout },
      context,
    );
    const data: PosCheckoutResult = {
      orderId: created.orderId,
      reference: created.reference,
      total: created.total,
      orderNumber: null,
      change: null,
    };

    const tendered = parsed.data.tenderedAmount;
    if (tendered !== null && hasPermission(actor, "payment.confirm_cash", { outletId: parsed.data.outletId })) {
      if (tendered < created.total) {
        // Harga berubah sejak ditampilkan — order disimpan, belum dibayar.
        data.warning = `Total terbaru ${formatRupiah(created.total)} melebihi uang diterima. Pesanan disimpan sebagai belum dibayar.`;
      } else {
        try {
          const paid = await confirmCashPayment(
            db,
            actor,
            { orderId: created.orderId, tenderedAmount: tendered },
            context,
          );
          data.orderNumber = paid.orderNumber;
          data.change = paid.change;
          refreshMenu(paid.menuBrandId);
        } catch (error) {
          // Order sudah tersimpan; pembayaran gagal (mis. stok produk jadi habis).
          if (!(error instanceof AccessError)) throw error;
          data.warning = `Pesanan disimpan sebagai belum dibayar: ${error.message}`;
        }
      }
    }
    refresh();
    return { ok: true, data, message: data.orderNumber ? `Pesanan ${data.orderNumber} dibuat.` : "Pesanan disimpan." };
  });
}

export async function confirmCashAction(input: unknown): Promise<ActionResult<{ orderNumber: string | null; change: number | null }>> {
  return runAction<{ orderNumber: string | null; change: number | null }>(async () => {
    const actor = await requireActionUser();
    const paid = await confirmCashPayment(db, actor, input, await getAuditContext());
    refreshMenu(paid.menuBrandId);
    refresh();
    return {
      ok: true,
      data: { orderNumber: paid.orderNumber, change: paid.change },
      message: paid.alreadyPaid
        ? `Sudah lunas sebelumnya (${paid.orderNumber}).`
        : `Pembayaran dikonfirmasi. Nomor antrean ${paid.orderNumber}.`,
    };
  });
}

export async function updateOrderStatusAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const actor = await requireActionUser();
    await updateOrderStatus(db, actor, input, await getAuditContext());
    refresh();
    return { ok: true, message: "Status diperbarui." };
  });
}

export async function cancelOrderAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const actor = await requireActionUser();
    const { result } = await cancelOrder(db, actor, input, await getAuditContext());
    refresh();
    return {
      ok: true,
      message:
        result === "cancelled"
          ? "Pesanan dibatalkan."
          : "Pembatalan diajukan dan menunggu persetujuan Manager.",
    };
  });
}

export async function decideCancellationAction(input: unknown): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const actor = await requireActionUser();
    const { approved, menuBrandId } = await decideCancellation(db, actor, input, await getAuditContext());
    refreshMenu(menuBrandId);
    refresh();
    return { ok: true, message: approved ? "Pembatalan disetujui." : "Pembatalan ditolak." };
  });
}
