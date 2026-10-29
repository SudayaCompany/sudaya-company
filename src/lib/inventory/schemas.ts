// Input operasi inventory. Browser hanya mengirim jumlah + satuan input;
// konversi ke satuan dasar & seluruh perhitungan saldo dilakukan server.

import { z } from "zod";

import { UNIT_CODES, isCountUnit, isUnitCode, parseQty } from "./units";

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${label} maksimal ${max} karakter.` })
    .optional()
    .transform((v) => v || null);

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || null)
  .refine((v) => v === null || datePattern.test(v), { error: "Format tanggal tidak valid." });

/** Jumlah input (desimal sederhana, "," atau "."). */
const amount = (label: string) =>
  z
    .string({ error: `${label} wajib diisi.` })
    .trim()
    .min(1, { error: `${label} wajib diisi.` })
    .max(24);

const unit = z.enum(UNIT_CODES, { error: "Satuan tidak valid." });

/** Kuantitas ≥ 0 untuk master item (minimum stock). */
const nonNegativeQty = (label: string) =>
  z
    .string()
    .trim()
    .max(24)
    .optional()
    .transform((v) => v || "0")
    .refine((v) => {
      const milli = parseQty(v);
      return milli !== null && milli >= 0n;
    }, { error: `${label} harus angka ≥ 0 (maks. 3 desimal).` });

const costText = z
  .string()
  .trim()
  .max(24)
  .optional()
  .transform((v) => v || null);

export const ITEM_KINDS = ["raw_material", "finished_good", "packaging"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  raw_material: "Bahan baku",
  finished_good: "Produk jadi",
  packaging: "Kemasan",
};

const itemFields = {
  name: z
    .string({ error: "Nama wajib diisi." })
    .trim()
    .min(2, { error: "Nama minimal 2 karakter." })
    .max(80, { error: "Nama maksimal 80 karakter." }),
  kind: z.enum(ITEM_KINDS, { error: "Pilih jenis item." }),
  category: optionalText(40, "Kategori"),
  minimumStock: nonNegativeQty("Minimum stok"),
  /** Harga pokok per satuan dasar item (Rupiah, maks. 4 desimal). */
  purchasePrice: costText,
  expiryDate: optionalDate,
};

export const itemCreateInput = z
  .object({
    outletId: z.uuid({ error: "Pilih outlet." }),
    sku: z
      .string({ error: "SKU wajib diisi." })
      .trim()
      .min(1, { error: "SKU wajib diisi." })
      .max(32, { error: "SKU maksimal 32 karakter." })
      .regex(/^[A-Za-z0-9._-]+$/, { error: "SKU hanya huruf, angka, titik, minus, atau garis bawah." })
      .transform((v) => v.toUpperCase()),
    unit,
    ...itemFields,
    /** Saldo awal (opsional) — diposting sebagai movement `opening`. */
    openingStock: nonNegativeQty("Stok awal"),
  })
  .refine((v) => !isCountUnit(v.unit) || parseQty(v.minimumStock)! % 1000n === 0n, {
    error: "Minimum stok satuan ini harus bilangan bulat.",
    path: ["minimumStock"],
  })
  .refine((v) => !isCountUnit(v.unit) || parseQty(v.openingStock)! % 1000n === 0n, {
    error: "Stok awal satuan ini harus bilangan bulat.",
    path: ["openingStock"],
  });

export const itemUpdateInput = z.object({
  itemId: z.uuid(),
  ...itemFields,
  isActive: z.boolean(),
});

export const linkProductsInput = z.object({
  itemId: z.uuid(),
  productIds: z.array(z.uuid()).max(20, { error: "Maksimal 20 produk." }),
});

export const openingBalanceInput = z.object({
  itemId: z.uuid(),
  quantity: amount("Stok awal"),
});

export const STOCK_IN_TYPES = ["purchase", "return"] as const;
export const STOCK_IN_LABELS: Record<(typeof STOCK_IN_TYPES)[number], string> = {
  purchase: "Pembelian",
  return: "Retur masuk",
};

export const stockInInput = z.object({
  idempotencyKey: z.uuid({ error: "Permintaan tidak valid. Muat ulang halaman." }),
  itemId: z.uuid({ error: "Pilih item." }),
  type: z.enum(STOCK_IN_TYPES),
  quantity: amount("Jumlah"),
  unit,
  effectiveDate: z.string().regex(datePattern, { error: "Tanggal wajib diisi." }),
  /** Harga per satuan input (opsional). */
  unitCost: costText,
  documentRef: optionalText(60, "Referensi"),
  batchCode: optionalText(40, "Batch"),
  expiryDate: optionalDate,
  notes: optionalText(300, "Catatan"),
});

/** Alasan stok keluar / waste → tipe ledger. */
export const ISSUE_REASONS = {
  internal_use: { type: "internal_use", label: "Pemakaian internal", waste: false },
  stock_out: { type: "stock_out", label: "Stok keluar lainnya", waste: false },
  damaged: { type: "damaged", label: "Rusak", waste: true },
  expired: { type: "expired", label: "Kedaluwarsa", waste: true },
  spilled: { type: "waste", label: "Tumpah", waste: true },
  wrong_production: { type: "waste", label: "Salah produksi", waste: true },
  other_waste: { type: "waste", label: "Waste lainnya", waste: true },
} as const;
export type IssueReason = keyof typeof ISSUE_REASONS;
export const ISSUE_REASON_CODES = Object.keys(ISSUE_REASONS) as IssueReason[];
export const WASTE_REASON_CODES = ISSUE_REASON_CODES.filter((r) => ISSUE_REASONS[r].waste);
export const STOCK_OUT_REASON_CODES = ISSUE_REASON_CODES.filter((r) => !ISSUE_REASONS[r].waste);

export const stockOutInput = z
  .object({
    idempotencyKey: z.uuid({ error: "Permintaan tidak valid. Muat ulang halaman." }),
    itemId: z.uuid({ error: "Pilih item." }),
    reason: z.enum(ISSUE_REASON_CODES, { error: "Pilih alasan." }),
    quantity: amount("Jumlah"),
    unit,
    notes: optionalText(300, "Catatan"),
  })
  .refine((v) => !["stock_out", "other_waste"].includes(v.reason) || (v.notes?.length ?? 0) >= 3, {
    error: "Jelaskan alasannya di catatan.",
    path: ["notes"],
  });

const reasonText = z
  .string({ error: "Alasan wajib diisi." })
  .trim()
  .min(5, { error: "Alasan minimal 5 karakter." })
  .max(300, { error: "Alasan maksimal 300 karakter." });

export const adjustmentInput = z.object({
  itemId: z.uuid({ error: "Pilih item." }),
  direction: z.enum(["in", "out"]),
  quantity: amount("Jumlah"),
  unit,
  reason: reasonText,
});

export const reversalInput = z.object({
  movementId: z.uuid(),
  reason: reasonText,
});

export const stockDecisionInput = z.object({
  approvalId: z.uuid(),
  approve: z.boolean(),
  note: z.string().trim().max(300).optional(),
});

export const opnameCreateInput = z.object({
  outletId: z.uuid({ error: "Pilih outlet." }),
  category: optionalText(40, "Kategori"),
  notes: optionalText(300, "Catatan"),
});

export const opnameCountsInput = z.object({
  opnameId: z.uuid(),
  counts: z
    .array(
      z.object({
        itemId: z.uuid(),
        /** null / "" = belum dihitung. Dalam satuan dasar item. */
        actualQty: z.string().trim().max(24).nullable().optional(),
        reason: optionalText(300, "Alasan"),
      }),
    )
    .min(1)
    .max(500),
});

export const opnameRefInput = z.object({ opnameId: z.uuid() });

export { isUnitCode };
