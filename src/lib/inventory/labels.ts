// Label tampilan inventory (modul murni, aman di browser).

import type { MovementType } from "./ledger";

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  opening: "Saldo awal",
  purchase: "Pembelian",
  return: "Retur masuk",
  adjustment_in: "Koreksi +",
  sale: "Penjualan",
  waste: "Waste",
  expired: "Kedaluwarsa",
  damaged: "Rusak",
  internal_use: "Pemakaian internal",
  adjustment_out: "Koreksi −",
  opname: "Stock opname",
  stock_out: "Stok keluar",
  reversal: "Reversal",
};

export const OPNAME_STATUS_LABELS = {
  draft: "Penghitungan",
  submitted: "Menunggu approval",
  applied: "Selesai",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
} as const;

export const STOCK_LEVEL_LABELS = {
  out: "Habis",
  low: "Menipis",
  ok: "Aman",
} as const;
