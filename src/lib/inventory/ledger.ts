// Ledger stok — SATU-SATUNYA jalur yang mengubah inventory_items.stock_qty.
//
// postMovement wajib dipanggil di dalam transaksi database:
// 1. kunci baris item (SELECT ... FOR UPDATE) → movement bersamaan untuk
//    item yang sama antre, saldo tidak pernah "lost update";
// 2. cek idempotency key (unik per outlet) → request ganda tidak memposting
//    dua kali (dan unique constraint menjadi pengaman terakhir);
// 3. tolak saldo akhir negatif (CHECK constraint di DB juga menolak);
// 4. update saldo cache + insert baris ledger append-only.

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/client";
import { inventoryItems, inventoryTransactions, outletProducts, orderItems } from "@/db/schema";
import { AccessError } from "@/lib/auth/errors";

import { formatQty, qtyFromDb, qtyToString } from "./units";

export type MovementType = (typeof inventoryTransactions.$inferInsert)["type"];

export type MovementInput = {
  itemId: string;
  type: MovementType;
  /** Milli-unit bertanda: positif = masuk, negatif = keluar. */
  quantity: bigint;
  idempotencyKey: string;
  actorId: string | null;
  /** Default: harga pokok item saat ini (untuk movement keluar). */
  unitCost?: string | null;
  reason?: string | null;
  photoPath?: string | null;
  documentRef?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  reversesId?: string | null;
  batchCode?: string | null;
  expiryDate?: string | null;
  effectiveDate?: string | null;
  /** Movement manual ditolak untuk item nonaktif; sistem (penjualan, reversal) boleh. */
  allowInactive?: boolean;
};

export type PostedMovement = {
  movementId: string;
  itemId: string;
  outletId: string;
  brandId: string;
  name: string;
  unit: string;
  before: bigint;
  after: bigint;
  /** true = idempotency key sudah pernah diposting (tidak ada perubahan baru). */
  replayed: boolean;
};

export async function postMovement(tx: DbExecutor, input: MovementInput): Promise<PostedMovement> {
  if (input.quantity === 0n) throw new AccessError("invalid", "Jumlah tidak boleh 0.");

  const [item] = await tx
    .select({
      id: inventoryItems.id,
      companyId: inventoryItems.companyId,
      brandId: inventoryItems.brandId,
      outletId: inventoryItems.outletId,
      name: inventoryItems.name,
      unit: inventoryItems.unit,
      stockQty: inventoryItems.stockQty,
      purchasePrice: inventoryItems.purchasePrice,
      isActive: inventoryItems.isActive,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, input.itemId))
    .for("update");
  if (!item) throw new AccessError("not_found", "Item stok tidak ditemukan.");

  const base = {
    itemId: item.id,
    outletId: item.outletId,
    brandId: item.brandId,
    name: item.name,
    unit: item.unit,
  };

  // Setelah lock: snapshot baru (READ COMMITTED) melihat posting yang sudah commit.
  const [existing] = await tx
    .select({
      id: inventoryTransactions.id,
      itemId: inventoryTransactions.itemId,
      quantity: inventoryTransactions.quantity,
      balanceAfter: inventoryTransactions.balanceAfter,
    })
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.outletId, item.outletId),
        eq(inventoryTransactions.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.itemId !== item.id) {
      throw new AccessError("conflict", "Kunci transaksi sudah dipakai untuk item lain.");
    }
    const after = qtyFromDb(existing.balanceAfter);
    return {
      ...base,
      movementId: existing.id,
      before: after - qtyFromDb(existing.quantity),
      after,
      replayed: true,
    };
  }

  if (!item.isActive && !input.allowInactive) {
    throw new AccessError("conflict", `${item.name} nonaktif. Aktifkan item terlebih dahulu.`);
  }

  const before = qtyFromDb(item.stockQty);
  const after = before + input.quantity;
  if (after < 0n) {
    throw new AccessError(
      "conflict",
      `Stok ${item.name} tidak cukup (tersisa ${formatQty(before, item.unit)}).`,
    );
  }

  await tx
    .update(inventoryItems)
    .set({ stockQty: qtyToString(after) })
    .where(eq(inventoryItems.id, item.id));

  const [row] = await tx
    .insert(inventoryTransactions)
    .values({
      companyId: item.companyId,
      brandId: item.brandId,
      outletId: item.outletId,
      itemId: item.id,
      type: input.type,
      quantity: qtyToString(input.quantity),
      balanceAfter: qtyToString(after),
      unitCost: input.unitCost === undefined ? item.purchasePrice : input.unitCost,
      reason: input.reason ?? null,
      photoPath: input.photoPath ?? null,
      documentRef: input.documentRef ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      reversesId: input.reversesId ?? null,
      batchCode: input.batchCode ?? null,
      expiryDate: input.expiryDate ?? null,
      // Default: tanggal hari ini menurut waktu DB di zona waktu outlet.
      effectiveDate:
        input.effectiveDate ??
        sql`(now() at time zone (select o.timezone from outlets o where o.id = ${item.outletId}::uuid))::date`,
      idempotencyKey: input.idempotencyKey,
      createdBy: input.actorId,
      // Diambil SETELAH lock item → urutan created_at = urutan posting, jadi
      // rantai balance_after terbaca berurutan walau transaksi berjalan bersamaan.
      createdAt: sql`clock_timestamp()`,
    })
    .returning({ id: inventoryTransactions.id });

  return { ...base, movementId: row.id, before, after, replayed: false };
}

/** true jika saldo melewati batas 0 (tersedia ↔ habis) — menu perlu di-refresh. */
export const crossedZero = (m: Pick<PostedMovement, "before" | "after" | "replayed">) =>
  !m.replayed && (m.before > 0n) !== (m.after > 0n);

// --- Integrasi penjualan produk jadi ------------------------------------------------

/**
 * Kebutuhan stok produk jadi untuk sebuah order: produk yang di outlet tsb
 * terhubung ke inventory item (outlet_products.inventory_item_id). Produk
 * racikan tanpa link TIDAK memotong bahan baku apa pun (BOM belum aktif).
 */
export async function finishedGoodDemand(tx: DbExecutor, orderId: string, outletId: string) {
  const rows = await tx
    .select({
      itemId: outletProducts.inventoryItemId,
      quantity: sql<number>`sum(${orderItems.quantity})::int`,
    })
    .from(orderItems)
    .innerJoin(
      outletProducts,
      and(eq(outletProducts.productId, orderItems.productId), eq(outletProducts.outletId, outletId)),
    )
    // Item harus milik outlet yang sama (pengaman bila link salah).
    .innerJoin(
      inventoryItems,
      and(eq(inventoryItems.id, outletProducts.inventoryItemId), eq(inventoryItems.outletId, outletId)),
    )
    .where(eq(orderItems.orderId, orderId))
    .groupBy(outletProducts.inventoryItemId);
  // Urut id → urutan lock konsisten antar transaksi (mencegah deadlock).
  return rows
    .map((r) => ({ itemId: r.itemId!, units: BigInt(r.quantity) }))
    .sort((a, b) => (a.itemId < b.itemId ? -1 : 1));
}

/** Potong stok produk jadi saat order dibayar. Idempotent per (order, item). */
export async function postSaleMovements(
  tx: DbExecutor,
  params: { orderId: string; outletId: string; actorId: string | null },
) {
  const demand = await finishedGoodDemand(tx, params.orderId, params.outletId);
  const posted: PostedMovement[] = [];
  for (const line of demand) {
    posted.push(
      await postMovement(tx, {
        itemId: line.itemId,
        type: "sale",
        quantity: -line.units * 1000n,
        idempotencyKey: `sale:${params.orderId}:${line.itemId}`,
        actorId: params.actorId,
        referenceType: "order",
        referenceId: params.orderId,
        allowInactive: true,
      }),
    );
  }
  return posted;
}

/** Kembalikan stok penjualan order yang dibatalkan (reversal tiap movement sale). */
export async function reverseSaleMovements(
  tx: DbExecutor,
  params: { orderId: string; actorId: string | null; reason: string },
) {
  const sales = await tx
    .select({
      id: inventoryTransactions.id,
      itemId: inventoryTransactions.itemId,
      quantity: inventoryTransactions.quantity,
      unitCost: inventoryTransactions.unitCost,
    })
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.referenceType, "order"),
        eq(inventoryTransactions.referenceId, params.orderId),
        eq(inventoryTransactions.type, "sale"),
      ),
    )
    .orderBy(asc(inventoryTransactions.itemId));
  if (sales.length === 0) return [];

  const reversed = await tx
    .select({ reversesId: inventoryTransactions.reversesId })
    .from(inventoryTransactions)
    .where(inArray(inventoryTransactions.reversesId, sales.map((s) => s.id)));
  const done = new Set(reversed.map((r) => r.reversesId));

  const posted: PostedMovement[] = [];
  for (const sale of sales) {
    if (done.has(sale.id)) continue;
    posted.push(
      await postMovement(tx, {
        itemId: sale.itemId,
        type: "reversal",
        quantity: -qtyFromDb(sale.quantity),
        idempotencyKey: `reversal:${sale.id}`,
        actorId: params.actorId,
        unitCost: sale.unitCost,
        reason: params.reason,
        referenceType: "order",
        referenceId: params.orderId,
        reversesId: sale.id,
        allowInactive: true,
      }),
    );
  }
  return posted;
}
