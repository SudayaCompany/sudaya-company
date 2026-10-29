// State machine order (PRD §107). Status produksi (orders.status) terpisah
// dari status pembayaran (orders.payment_status, PRD §108). Modul murni —
// dipakai server untuk validasi dan UI untuk label.

export type OrderStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "queued"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled"
  | "refunded";

export type PaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "expired"
  | "refunded"
  | "partial_refund";

export type OrderChannel = "pos" | "qr_table" | "qr_counter" | "website" | "kiosk";
export type OrderType = "dine_in" | "takeaway" | "delivery";

/** Transisi produksi normal (KDS). Pembayaran & pembatalan punya alur sendiri. */
const PRODUCTION_FLOW: Partial<Record<OrderStatus, OrderStatus>> = {
  queued: "preparing",
  preparing: "ready",
  ready: "completed",
};

/** Mundur satu langkah untuk koreksi salah tekan — butuh kds.manage. */
const OVERRIDE_FLOW: Partial<Record<OrderStatus, OrderStatus>> = {
  preparing: "queued",
  ready: "preparing",
};

export function nextProductionStatus(from: OrderStatus) {
  return PRODUCTION_FLOW[from] ?? null;
}

export function transitionKind(from: OrderStatus, to: OrderStatus) {
  if (PRODUCTION_FLOW[from] === to) return "normal" as const;
  if (OVERRIDE_FLOW[from] === to) return "override" as const;
  return null;
}

/** Status yang tidak bisa diubah lagi lewat KDS. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = ["completed", "cancelled", "refunded"];

/** Order yang tampil di KDS (sudah dibayar & belum selesai). */
export const ACTIVE_QUEUE_STATUSES = ["queued", "preparing", "ready"] as const;

/** Label untuk customer (halaman status). */
export function customerStatusLabel(status: OrderStatus) {
  switch (status) {
    case "draft":
    case "pending_payment":
      return "Menunggu pembayaran";
    case "paid":
    case "queued":
      return "Pesanan diterima";
    case "preparing":
      return "Sedang dibuat";
    case "ready":
      return "Siap diambil";
    case "completed":
      return "Selesai";
    case "cancelled":
    case "refunded":
      return "Dibatalkan";
  }
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Draft",
  pending_payment: "Menunggu bayar",
  paid: "Dibayar",
  queued: "Antre",
  preparing: "Dibuat",
  ready: "Siap",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  refunded: "Refund",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Belum dibayar",
  paid: "Lunas",
  failed: "Gagal",
  expired: "Tidak dibayar",
  refunded: "Dikembalikan",
  partial_refund: "Refund sebagian",
};

export const CHANNEL_LABELS: Record<OrderChannel, string> = {
  pos: "POS",
  qr_table: "QR Meja",
  qr_counter: "QR Kasir",
  website: "Web",
  kiosk: "Kiosk",
};

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: "Dine In",
  takeaway: "Takeaway",
  delivery: "Delivery",
};

/** Referensi pendek untuk dicari kasir sebelum nomor antrean ada. */
export function orderReference(orderId: string) {
  return orderId.replace(/-/g, "").slice(0, 6).toUpperCase();
}

/** 1 → "SDY-001" (PRD §37). */
export function formatOrderNumber(prefix: string, queueNumber: number) {
  return `${prefix}-${String(queueNumber).padStart(3, "0")}`;
}
