// Query halaman inventory. Semua dibatasi company + outlet yang diizinkan;
// angka (nilai stok, nilai waste) hanya dari data biaya asli — item/movement
// tanpa harga pokok tidak ditebak, tetapi dihitung terpisah sebagai "tanpa biaya".

import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { DbExecutor } from "@/db/client";
import {
  approvals,
  inventoryAdjustments,
  inventoryItems,
  inventoryTransactions,
  outletProducts,
  outlets,
  products,
  stockOpnameItems,
  stockOpnames,
  users,
} from "@/db/schema";
import type { CurrentUser } from "@/lib/auth/access";
import { AccessError } from "@/lib/auth/errors";
import { hasPermission } from "@/lib/auth/policy";
import { businessDateIn } from "@/lib/orders/dates";

import type { EvidenceStorage } from "./evidence";
import { assertInventory, isReversible } from "./ops";
import { ITEM_KINDS } from "./schemas";
import { stockLevel } from "./units";

export const INVENTORY_PAGE_SIZE = 25;
const WASTE_TYPES = ["waste", "expired", "damaged"] as const;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
const notFound = () => new AccessError("not_found", "Data stok tidak ditemukan.");

/** Nilai Rupiah (numeric → number, dibulatkan ke rupiah). */
const rupiah = (value: string | null) => (value === null ? null : Math.round(Number(value)));

async function outletOf(db: DbExecutor, actor: CurrentUser, outletId: string) {
  const [outlet] = await db
    .select({ id: outlets.id, name: outlets.name, timezone: outlets.timezone, brandId: outlets.brandId })
    .from(outlets)
    .where(and(eq(outlets.id, outletId), eq(outlets.companyId, actor.company.id)))
    .limit(1);
  if (!outlet) throw notFound();
  assertInventory(actor, "inventory.view", outlet.id);
  return outlet;
}

// --- Item ------------------------------------------------------------------------------

export const itemListParams = z.object({
  q: z.string().trim().max(60).optional().catch(undefined),
  kind: z.enum(ITEM_KINDS).optional().catch(undefined),
  level: z.enum(["out", "low", "ok"]).optional().catch(undefined),
  status: z.enum(["active", "inactive", "all"]).catch("active"),
  category: z.string().trim().max(40).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type ItemListParams = z.infer<typeof itemListParams>;

const levelCondition = (level: "out" | "low" | "ok") =>
  level === "out"
    ? sql`${inventoryItems.stockQty} <= 0`
    : level === "low"
      ? sql`${inventoryItems.stockQty} > 0 and ${inventoryItems.stockQty} <= ${inventoryItems.minimumStock}`
      : sql`${inventoryItems.stockQty} > ${inventoryItems.minimumStock}`;

export async function listItems(db: DbExecutor, actor: CurrentUser, outletId: string, params: ItemListParams) {
  const outlet = await outletOf(db, actor, outletId);
  const conditions: (SQL | undefined)[] = [
    eq(inventoryItems.outletId, outlet.id),
    eq(inventoryItems.companyId, actor.company.id),
  ];
  if (params.q) {
    const pattern = `%${escapeLike(params.q)}%`;
    conditions.push(or(ilike(inventoryItems.name, pattern), ilike(inventoryItems.sku, pattern)));
  }
  if (params.kind) conditions.push(eq(inventoryItems.kind, params.kind));
  if (params.category) conditions.push(eq(inventoryItems.category, params.category));
  if (params.status !== "all") conditions.push(eq(inventoryItems.isActive, params.status === "active"));
  if (params.level) conditions.push(levelCondition(params.level));
  const where = and(...conditions);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(inventoryItems).where(where);
  const pageCount = Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE));
  const page = Math.min(params.page, pageCount);

  const rows = await db
    .select({
      id: inventoryItems.id,
      sku: inventoryItems.sku,
      name: inventoryItems.name,
      kind: inventoryItems.kind,
      category: inventoryItems.category,
      unit: inventoryItems.unit,
      stockQty: inventoryItems.stockQty,
      minimumStock: inventoryItems.minimumStock,
      purchasePrice: inventoryItems.purchasePrice,
      expiryDate: inventoryItems.expiryDate,
      isActive: inventoryItems.isActive,
      stockValue: sql<string | null>`${inventoryItems.stockQty} * ${inventoryItems.purchasePrice}`,
      // Nama tabel ditulis eksplisit agar subquery berkorelasi ke baris luar.
      hasMovements: sql<boolean>`exists (select 1 from inventory_transactions t where t.item_id = inventory_items.id)`,
    })
    .from(inventoryItems)
    .where(where)
    // Yang perlu perhatian dulu: habis, menipis, lalu nama.
    .orderBy(
      sql`case when ${inventoryItems.stockQty} <= 0 then 0 when ${inventoryItems.stockQty} <= ${inventoryItems.minimumStock} then 1 else 2 end`,
      asc(inventoryItems.name),
    )
    .limit(INVENTORY_PAGE_SIZE)
    .offset((page - 1) * INVENTORY_PAGE_SIZE);

  const links = rows.length
    ? await db
        .select({ itemId: outletProducts.inventoryItemId, productName: products.name })
        .from(outletProducts)
        .innerJoin(products, eq(products.id, outletProducts.productId))
        .where(
          and(
            eq(outletProducts.outletId, outlet.id),
            inArray(outletProducts.inventoryItemId, rows.map((r) => r.id)),
          ),
        )
    : [];

  const categories = await db
    .selectDistinct({ category: inventoryItems.category })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.outletId, outlet.id), isNotNull(inventoryItems.category)))
    .orderBy(asc(inventoryItems.category));

  return {
    outlet,
    rows: rows.map((r) => ({
      ...r,
      level: stockLevel(r.stockQty, r.minimumStock),
      stockValue: rupiah(r.stockValue),
      linkedProducts: links.filter((l) => l.itemId === r.id).map((l) => l.productName),
    })),
    total,
    page,
    pageCount,
    categories: categories.map((c) => c.category!),
  };
}
export type ItemRow = Awaited<ReturnType<typeof listItems>>["rows"][number];

/** Item aktif untuk form stok masuk/keluar/koreksi. */
export async function listItemOptions(db: DbExecutor, actor: CurrentUser, outletId: string) {
  const outlet = await outletOf(db, actor, outletId);
  return db
    .select({
      id: inventoryItems.id,
      sku: inventoryItems.sku,
      name: inventoryItems.name,
      kind: inventoryItems.kind,
      unit: inventoryItems.unit,
      stockQty: inventoryItems.stockQty,
      minimumStock: inventoryItems.minimumStock,
      purchasePrice: inventoryItems.purchasePrice,
    })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.outletId, outlet.id), eq(inventoryItems.isActive, true)))
    .orderBy(asc(inventoryItems.name));
}
export type ItemOption = Awaited<ReturnType<typeof listItemOptions>>[number];

export async function getItemDetail(db: DbExecutor, actor: CurrentUser, itemId: string) {
  const id = z.uuid().safeParse(itemId);
  if (!id.success) throw notFound();
  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, id.data), eq(inventoryItems.companyId, actor.company.id)))
    .limit(1);
  if (!item) throw notFound();
  await outletOf(db, actor, item.outletId);

  const [linked, movementCount] = await Promise.all([
    db
      .select({ productId: outletProducts.productId, name: products.name })
      .from(outletProducts)
      .innerJoin(products, eq(products.id, outletProducts.productId))
      .where(and(eq(outletProducts.outletId, item.outletId), eq(outletProducts.inventoryItemId, item.id))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.itemId, item.id)),
  ]);
  return { item, linked, hasMovements: movementCount[0].count > 0 };
}

/** Produk menu brand outlet ini + item produk jadi yang sedang terhubung. */
export async function productLinkOptions(db: DbExecutor, actor: CurrentUser, outletId: string) {
  const outlet = await outletOf(db, actor, outletId);
  const linkedItem = alias(inventoryItems, "linked_item");
  return db
    .select({
      id: products.id,
      name: products.name,
      linkedItemId: outletProducts.inventoryItemId,
      linkedItemName: linkedItem.name,
    })
    .from(products)
    .leftJoin(outletProducts, and(eq(outletProducts.productId, products.id), eq(outletProducts.outletId, outlet.id)))
    .leftJoin(linkedItem, eq(linkedItem.id, outletProducts.inventoryItemId))
    .where(and(eq(products.brandId, outlet.brandId), sql`${products.deletedAt} is null`))
    .orderBy(asc(products.name));
}

// --- Ledger --------------------------------------------------------------------------------

export const MOVEMENT_TYPES = [
  "opening",
  "purchase",
  "return",
  "sale",
  "stock_out",
  "internal_use",
  "waste",
  "expired",
  "damaged",
  "adjustment_in",
  "adjustment_out",
  "opname",
  "reversal",
] as const;

export const movementListParams = z.object({
  q: z.string().trim().max(60).optional().catch(undefined),
  type: z.enum(MOVEMENT_TYPES).optional().catch(undefined),
  item: z.uuid().optional().catch(undefined),
  from: z.string().regex(datePattern).optional().catch(undefined),
  to: z.string().regex(datePattern).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type MovementListParams = z.infer<typeof movementListParams> & {
  /** Filter beberapa jenis sekaligus (dipakai halaman, bukan dari URL). */
  types?: readonly (typeof MOVEMENT_TYPES)[number][];
};

export async function listMovements(
  db: DbExecutor,
  actor: CurrentUser,
  outletId: string,
  params: MovementListParams,
  pageSize = INVENTORY_PAGE_SIZE,
) {
  const outlet = await outletOf(db, actor, outletId);
  const t = inventoryTransactions;
  const conditions: (SQL | undefined)[] = [eq(t.outletId, outlet.id), eq(t.companyId, actor.company.id)];
  if (params.q) {
    const pattern = `%${escapeLike(params.q)}%`;
    conditions.push(
      or(ilike(inventoryItems.name, pattern), ilike(inventoryItems.sku, pattern), ilike(t.documentRef, pattern)),
    );
  }
  if (params.type) conditions.push(eq(t.type, params.type));
  if (params.types?.length) conditions.push(inArray(t.type, [...params.types]));
  if (params.item) conditions.push(eq(t.itemId, params.item));
  if (params.from) conditions.push(gte(t.effectiveDate, params.from));
  if (params.to) conditions.push(lte(t.effectiveDate, params.to));
  const where = and(...conditions);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(t)
    .innerJoin(inventoryItems, eq(inventoryItems.id, t.itemId))
    .where(where);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(params.page, pageCount);

  const reversal = alias(inventoryTransactions, "reversal_tx");
  const actorUser = alias(users, "actor_user");
  const rows = await db
    .select({
      id: t.id,
      type: t.type,
      quantity: t.quantity,
      balanceAfter: t.balanceAfter,
      unitCost: t.unitCost,
      value: sql<string | null>`abs(${t.quantity}) * ${t.unitCost}`,
      reason: t.reason,
      documentRef: t.documentRef,
      batchCode: t.batchCode,
      hasPhoto: sql<boolean>`${t.photoPath} is not null`,
      referenceType: t.referenceType,
      referenceId: t.referenceId,
      reversesId: t.reversesId,
      effectiveDate: t.effectiveDate,
      createdAt: t.createdAt,
      itemId: inventoryItems.id,
      itemName: inventoryItems.name,
      itemSku: inventoryItems.sku,
      unit: inventoryItems.unit,
      actorName: actorUser.fullName,
      reversedById: reversal.id,
    })
    .from(t)
    .innerJoin(inventoryItems, eq(inventoryItems.id, t.itemId))
    .leftJoin(actorUser, eq(actorUser.id, t.createdBy))
    .leftJoin(reversal, eq(reversal.reversesId, t.id))
    .where(where)
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const pendingReversals = rows.length
    ? await db
        .select({ reversesId: inventoryAdjustments.reversesId })
        .from(inventoryAdjustments)
        .innerJoin(approvals, eq(approvals.id, inventoryAdjustments.approvalId))
        .where(
          and(
            inArray(inventoryAdjustments.reversesId, rows.map((r) => r.id)),
            eq(approvals.status, "pending"),
          ),
        )
    : [];
  const pending = new Set(pendingReversals.map((p) => p.reversesId));

  return {
    outlet,
    rows: rows.map((r) => ({
      ...r,
      value: rupiah(r.value),
      reversalPending: pending.has(r.id),
      canReverse: isReversible(r.type) && !r.reversedById && !pending.has(r.id),
    })),
    total,
    page,
    pageCount,
  };
}
export type MovementRow = Awaited<ReturnType<typeof listMovements>>["rows"][number];

/** Pengajuan koreksi/reversal/opname yang menunggu keputusan di outlet ini. */
export async function listPendingStockApprovals(db: DbExecutor, actor: CurrentUser, outletId: string) {
  const outlet = await outletOf(db, actor, outletId);
  const requester = alias(users, "requester");
  const rows = await db
    .select({
      id: approvals.id,
      type: approvals.type,
      referenceId: approvals.referenceId,
      reason: approvals.reason,
      requestedBy: approvals.requestedBy,
      requestedByName: requester.fullName,
      createdAt: approvals.createdAt,
      adjustmentQty: inventoryAdjustments.quantity,
      reversesId: inventoryAdjustments.reversesId,
      itemId: inventoryItems.id,
      itemName: inventoryItems.name,
      unit: inventoryItems.unit,
      stockQty: inventoryItems.stockQty,
    })
    .from(approvals)
    .innerJoin(requester, eq(requester.id, approvals.requestedBy))
    .leftJoin(inventoryAdjustments, eq(inventoryAdjustments.approvalId, approvals.id))
    .leftJoin(inventoryItems, eq(inventoryItems.id, inventoryAdjustments.itemId))
    .where(
      and(
        eq(approvals.outletId, outlet.id),
        eq(approvals.companyId, actor.company.id),
        eq(approvals.status, "pending"),
        inArray(approvals.type, ["stock_adjustment", "stock_opname"]),
      ),
    )
    .orderBy(asc(approvals.createdAt));
  const canApprove = hasPermission(actor, "approval.approve", { outletId: outlet.id });
  const canReject = hasPermission(actor, "approval.reject", { outletId: outlet.id });
  return rows.map((r) => ({
    ...r,
    canApprove: canApprove && r.requestedBy !== actor.id,
    canReject: canReject && r.requestedBy !== actor.id,
  }));
}
export type PendingStockApproval = Awaited<ReturnType<typeof listPendingStockApprovals>>[number];

export async function evidenceUrl(
  db: DbExecutor,
  actor: CurrentUser,
  movementId: string,
  storage: EvidenceStorage,
) {
  const id = z.uuid().safeParse(movementId);
  if (!id.success) throw notFound();
  const [row] = await db
    .select({ outletId: inventoryTransactions.outletId, photoPath: inventoryTransactions.photoPath })
    .from(inventoryTransactions)
    .where(and(eq(inventoryTransactions.id, id.data), eq(inventoryTransactions.companyId, actor.company.id)))
    .limit(1);
  if (!row?.photoPath) throw notFound();
  assertInventory(actor, "inventory.view", row.outletId);
  return storage.signedUrl(row.photoPath, 60);
}

// --- Dashboard & waste ------------------------------------------------------------------------

function monthStart(timezone: string) {
  return `${businessDateIn(timezone).slice(0, 8)}01`;
}

export async function inventoryDashboard(db: DbExecutor, actor: CurrentUser, outletId: string) {
  const outlet = await outletOf(db, actor, outletId);
  const today = businessDateIn(outlet.timezone);
  const since = monthStart(outlet.timezone);
  const i = inventoryItems;
  const t = inventoryTransactions;

  const [summary] = await db
    .select({
      active: sql<number>`count(*) filter (where ${i.isActive})::int`,
      inactive: sql<number>`count(*) filter (where not ${i.isActive})::int`,
      out: sql<number>`count(*) filter (where ${i.isActive} and ${i.stockQty} <= 0)::int`,
      low: sql<number>`count(*) filter (where ${i.isActive} and ${i.stockQty} > 0 and ${i.stockQty} <= ${i.minimumStock})::int`,
      costed: sql<number>`count(*) filter (where ${i.isActive} and ${i.purchasePrice} is not null)::int`,
      stockValue: sql<string | null>`sum(${i.stockQty} * ${i.purchasePrice}) filter (where ${i.isActive})`,
      expiringSoon: sql<number>`count(*) filter (where ${i.isActive} and ${i.stockQty} > 0 and ${i.expiryDate} <= ${today}::date + 7)::int`,
    })
    .from(i)
    .where(eq(i.outletId, outlet.id));

  const [waste] = await db
    .select({
      events: sql<number>`count(*)::int`,
      uncosted: sql<number>`count(*) filter (where ${t.unitCost} is null)::int`,
      value: sql<string | null>`sum(abs(${t.quantity}) * ${t.unitCost})`,
    })
    .from(t)
    .where(and(eq(t.outletId, outlet.id), inArray(t.type, [...WASTE_TYPES]), gte(t.effectiveDate, since)));

  const [adjustments] = await db
    .select({
      events: sql<number>`count(*)::int`,
      value: sql<string | null>`sum(${t.quantity} * ${t.unitCost})`,
      uncosted: sql<number>`count(*) filter (where ${t.unitCost} is null)::int`,
    })
    .from(t)
    .where(
      and(
        eq(t.outletId, outlet.id),
        inArray(t.type, ["adjustment_in", "adjustment_out", "opname", "reversal"]),
        gte(t.effectiveDate, since),
      ),
    );

  const [lastOpname] = await db
    .select({ id: stockOpnames.id, postedAt: stockOpnames.postedAt })
    .from(stockOpnames)
    .where(and(eq(stockOpnames.outletId, outlet.id), eq(stockOpnames.status, "applied")))
    .orderBy(desc(stockOpnames.postedAt))
    .limit(1);
  const opnameVariance = lastOpname
    ? (
        await db
          .select({
            counted: sql<number>`count(*) filter (where ${stockOpnameItems.actualQty} is not null)::int`,
            withVariance: sql<number>`count(*) filter (where ${stockOpnameItems.variance} <> 0)::int`,
            value: sql<string | null>`sum(${stockOpnameItems.variance} * ${i.purchasePrice})`,
          })
          .from(stockOpnameItems)
          .innerJoin(i, eq(i.id, stockOpnameItems.itemId))
          .where(eq(stockOpnameItems.opnameId, lastOpname.id))
      )[0]
    : null;

  const [attention, recent, pending] = await Promise.all([
    db
      .select({
        id: i.id,
        name: i.name,
        sku: i.sku,
        unit: i.unit,
        stockQty: i.stockQty,
        minimumStock: i.minimumStock,
      })
      .from(i)
      .where(and(eq(i.outletId, outlet.id), eq(i.isActive, true), sql`${i.stockQty} <= ${i.minimumStock}`))
      .orderBy(asc(sql`${i.stockQty} > 0`), asc(i.name))
      .limit(8),
    listMovements(db, actor, outlet.id, { page: 1 }, 8),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(approvals)
      .where(
        and(
          eq(approvals.outletId, outlet.id),
          eq(approvals.status, "pending"),
          inArray(approvals.type, ["stock_adjustment", "stock_opname"]),
        ),
      ),
  ]);

  return {
    outlet,
    since,
    summary: { ...summary, stockValue: rupiah(summary.stockValue) },
    waste: { ...waste, value: rupiah(waste.value) },
    adjustments: { ...adjustments, value: rupiah(adjustments.value) },
    lastOpname: lastOpname && opnameVariance
      ? { ...lastOpname, ...opnameVariance, value: rupiah(opnameVariance.value) }
      : null,
    attention: attention.map((a) => ({ ...a, level: stockLevel(a.stockQty, a.minimumStock) })),
    recent: recent.rows,
    pendingApprovals: pending[0].count,
  };
}

export const wasteParams = z.object({
  from: z.string().regex(datePattern).optional().catch(undefined),
  to: z.string().regex(datePattern).optional().catch(undefined),
});

export async function wasteSummary(
  db: DbExecutor,
  actor: CurrentUser,
  outletId: string,
  params: z.infer<typeof wasteParams>,
) {
  const outlet = await outletOf(db, actor, outletId);
  const from = params.from ?? monthStart(outlet.timezone);
  const to = params.to ?? businessDateIn(outlet.timezone);
  const t = inventoryTransactions;
  const where = and(
    eq(t.outletId, outlet.id),
    inArray(t.type, [...WASTE_TYPES]),
    gte(t.effectiveDate, from),
    lte(t.effectiveDate, to),
  );
  // Label alasan ditulis server ("Rusak: catatan") → aman dikelompokkan.
  const reasonLabel = sql<string>`split_part(${t.reason}, ':', 1)`;

  const [totals, byReason, byItem] = await Promise.all([
    db
      .select({
        events: sql<number>`count(*)::int`,
        uncosted: sql<number>`count(*) filter (where ${t.unitCost} is null)::int`,
        value: sql<string | null>`sum(abs(${t.quantity}) * ${t.unitCost})`,
      })
      .from(t)
      .where(where),
    db
      .select({
        label: reasonLabel,
        events: sql<number>`count(*)::int`,
        value: sql<string | null>`sum(abs(${t.quantity}) * ${t.unitCost})`,
      })
      .from(t)
      .where(where)
      .groupBy(reasonLabel)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({
        itemId: inventoryItems.id,
        name: inventoryItems.name,
        unit: inventoryItems.unit,
        events: sql<number>`count(*)::int`,
        // Per item → satu satuan; jumlah tidak pernah dicampur antar satuan.
        quantity: sql<string>`sum(abs(${t.quantity}))`,
        value: sql<string | null>`sum(abs(${t.quantity}) * ${t.unitCost})`,
        uncosted: sql<number>`count(*) filter (where ${t.unitCost} is null)::int`,
      })
      .from(t)
      .innerJoin(inventoryItems, eq(inventoryItems.id, t.itemId))
      .where(where)
      .groupBy(inventoryItems.id, inventoryItems.name, inventoryItems.unit)
      .orderBy(desc(sql`sum(abs(${t.quantity}) * coalesce(${t.unitCost}, 0))`), asc(inventoryItems.name))
      .limit(20),
  ]);

  return {
    outlet,
    from,
    to,
    totals: { ...totals[0], value: rupiah(totals[0].value) },
    byReason: byReason.map((r) => ({ ...r, value: rupiah(r.value) })),
    byItem: byItem.map((r) => ({ ...r, value: rupiah(r.value) })),
  };
}

// --- Opname ---------------------------------------------------------------------------------

export async function listOpnames(db: DbExecutor, actor: CurrentUser, outletId: string) {
  const outlet = await outletOf(db, actor, outletId);
  const creator = alias(users, "creator");
  const rows = await db
    .select({
      id: stockOpnames.id,
      status: stockOpnames.status,
      notes: stockOpnames.notes,
      snapshotAt: stockOpnames.snapshotAt,
      submittedAt: stockOpnames.submittedAt,
      postedAt: stockOpnames.postedAt,
      createdByName: creator.fullName,
    })
    .from(stockOpnames)
    .leftJoin(creator, eq(creator.id, stockOpnames.createdBy))
    .where(and(eq(stockOpnames.outletId, outlet.id), eq(stockOpnames.companyId, actor.company.id)))
    .orderBy(desc(stockOpnames.snapshotAt))
    .limit(30);
  const stats = rows.length
    ? await db
        .select({
          opnameId: stockOpnameItems.opnameId,
          items: sql<number>`count(*)::int`,
          counted: sql<number>`count(*) filter (where ${stockOpnameItems.actualQty} is not null)::int`,
          withVariance: sql<number>`count(*) filter (where ${stockOpnameItems.variance} <> 0)::int`,
        })
        .from(stockOpnameItems)
        .where(inArray(stockOpnameItems.opnameId, rows.map((r) => r.id)))
        .groupBy(stockOpnameItems.opnameId)
    : [];
  return {
    outlet,
    rows: rows.map((r) => ({
      ...r,
      ...(stats.find((s) => s.opnameId === r.id) ?? { items: 0, counted: 0, withVariance: 0 }),
    })),
  };
}

export async function getOpname(db: DbExecutor, actor: CurrentUser, opnameId: string) {
  const id = z.uuid().safeParse(opnameId);
  if (!id.success) throw notFound();
  const creator = alias(users, "creator");
  const decider = alias(users, "decider");
  const requester = alias(users, "requester");
  const [opname] = await db
    .select({
      id: stockOpnames.id,
      outletId: stockOpnames.outletId,
      status: stockOpnames.status,
      notes: stockOpnames.notes,
      snapshotAt: stockOpnames.snapshotAt,
      submittedAt: stockOpnames.submittedAt,
      postedAt: stockOpnames.postedAt,
      approvalId: stockOpnames.approvalId,
      createdByName: creator.fullName,
      approvalStatus: approvals.status,
      requestedBy: approvals.requestedBy,
      requestedByName: requester.fullName,
      decidedByName: decider.fullName,
      decisionNote: approvals.decisionNote,
      decidedAt: approvals.decidedAt,
    })
    .from(stockOpnames)
    .leftJoin(creator, eq(creator.id, stockOpnames.createdBy))
    .leftJoin(approvals, eq(approvals.id, stockOpnames.approvalId))
    .leftJoin(requester, eq(requester.id, approvals.requestedBy))
    .leftJoin(decider, eq(decider.id, approvals.decidedBy))
    .where(and(eq(stockOpnames.id, id.data), eq(stockOpnames.companyId, actor.company.id)))
    .limit(1);
  if (!opname) throw notFound();
  const outlet = await outletOf(db, actor, opname.outletId);

  const items = await db
    .select({
      itemId: inventoryItems.id,
      sku: inventoryItems.sku,
      name: inventoryItems.name,
      category: inventoryItems.category,
      unit: inventoryItems.unit,
      currentQty: inventoryItems.stockQty,
      purchasePrice: inventoryItems.purchasePrice,
      systemQty: stockOpnameItems.systemQty,
      actualQty: stockOpnameItems.actualQty,
      variance: stockOpnameItems.variance,
      reason: stockOpnameItems.reason,
      varianceValue: sql<string | null>`${stockOpnameItems.variance} * ${inventoryItems.purchasePrice}`,
    })
    .from(stockOpnameItems)
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockOpnameItems.itemId))
    .where(eq(stockOpnameItems.opnameId, opname.id))
    .orderBy(asc(inventoryItems.category), asc(inventoryItems.name));

  const pendingDecision = opname.status === "submitted" && opname.approvalStatus === "pending";
  return {
    opname,
    outlet,
    items: items.map((r) => ({ ...r, varianceValue: rupiah(r.varianceValue) })),
    canCount: opname.status === "draft" && hasPermission(actor, "inventory.opname", { outletId: outlet.id }),
    canApprove:
      pendingDecision &&
      opname.requestedBy !== actor.id &&
      hasPermission(actor, "approval.approve", { outletId: outlet.id }),
    canReject:
      pendingDecision &&
      opname.requestedBy !== actor.id &&
      hasPermission(actor, "approval.reject", { outletId: outlet.id }),
  };
}
export type OpnameDetail = Awaited<ReturnType<typeof getOpname>>;
