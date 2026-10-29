import { pgEnum } from "drizzle-orm/pg-core";

// PRD §107 — status order, terpisah dari status pembayaran (§108).
export const orderStatus = pgEnum("order_status", [
  "draft",
  "pending_payment",
  "paid",
  "queued",
  "preparing",
  "ready",
  "completed",
  "cancelled",
  "refunded",
]);

// PRD §45
export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "paid",
  "failed",
  "expired",
  "refunded",
  "partial_refund",
]);

// PRD §42
export const paymentMethod = pgEnum("payment_method", [
  "cash",
  "qris",
  "debit",
  "credit_card",
  "e_wallet",
  "transfer",
  "payment_gateway",
]);

// PRD §31, §35 — semua channel masuk ke satu antrean (§36).
export const orderChannel = pgEnum("order_channel", [
  "pos",
  "qr_table",
  "qr_counter",
  "website",
  "kiosk",
]);

// PRD §34
export const orderType = pgEnum("order_type", [
  "dine_in",
  "takeaway",
  "delivery",
]);

// PRD §70
export const approvalStatus = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

// PRD §69
export const approvalType = pgEnum("approval_type", [
  "void",
  "refund",
  "stock_adjustment",
  "expense",
  "outside_duty",
]);

// PRD §18
export const inventoryItemKind = pgEnum("inventory_item_kind", [
  "raw_material",
  "finished_good",
]);

// PRD §22 — tanda (+/-) disimpan di kolom quantity ledger.
export const inventoryTransactionType = pgEnum("inventory_transaction_type", [
  "purchase",
  "return",
  "adjustment_in",
  "sale",
  "waste",
  "expired",
  "damaged",
  "internal_use",
  "adjustment_out",
  "opname",
]);

export const stockOpnameStatus = pgEnum("stock_opname_status", [
  "draft",
  "submitted",
  "applied",
]);

export const attendanceStatus = pgEnum("attendance_status", [
  "checked_in",
  "checked_out",
]);

export const cashSessionStatus = pgEnum("cash_session_status", [
  "open",
  "closed",
]);

export const modifierSelection = pgEnum("modifier_selection", [
  "single",
  "multiple",
]);
