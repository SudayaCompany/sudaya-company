import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, money, timestamps } from "./columns";
import { approvals } from "./control";
import { cashSessionStatus, paymentMethod, paymentStatus } from "./enums";
import { createdBy, users } from "./identity";
import { orders } from "./orders";
import { tenantColumns } from "./tenancy";

// PRD §56–58 — opening/closing kas per shift.
export const cashSessions = pgTable(
  "cash_sessions",
  {
    id: id(),
    ...tenantColumns(),
    status: cashSessionStatus().notNull().default("open"),
    openedBy: uuid()
      .notNull()
      .references(() => users.id),
    openedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    openingAmount: money().notNull(),
    closedBy: uuid().references(() => users.id),
    closedAt: timestamp({ withTimezone: true }),
    expectedAmount: money(),
    actualAmount: money(),
    /** Wajib diisi jika actual ≠ expected (divalidasi di aplikasi). */
    varianceReason: text(),
    ...timestamps(),
  },
  (t) => [index().on(t.outletId, t.status)],
).enableRLS();

/** Satu order bisa punya beberapa payment (split payment, PRD §47). */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    ...tenantColumns(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    method: paymentMethod().notNull(),
    status: paymentStatus().notNull().default("pending"),
    amount: money().notNull(),

    /** Cash: uang diterima & kembalian, terikat ke sesi kas. */
    cashSessionId: uuid().references(() => cashSessions.id),
    tenderedAmount: money(),
    changeAmount: money(),

    /** Gateway (QRIS dll.): mis. midtrans / xendit. */
    provider: text(),
    providerReference: text(),
    providerPayload: jsonb(),
    expiresAt: timestamp({ withTimezone: true }),

    paidAt: timestamp({ withTimezone: true }),
    /** Kasir yang menekan "Confirm Payment" (PRD §43). */
    confirmedBy: uuid().references(() => users.id),
    createdBy: createdBy(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.provider, t.providerReference),
    index().on(t.orderId),
    index().on(t.cashSessionId),
  ],
).enableRLS();

/** PRD §101 — callback gateway diproses sekali per event. */
export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: id(),
    provider: text().notNull(),
    eventId: text().notNull(),
    payload: jsonb().notNull(),
    processedAt: timestamp({ withTimezone: true }),
    error: text(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.provider, t.eventId)],
).enableRLS();

// PRD §49 — Request → Reason → Approval → Refund.
export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    ...tenantColumns(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id),
    amount: money().notNull(),
    reason: text().notNull(),
    approvalId: uuid().references(() => approvals.id),
    refundedAt: timestamp({ withTimezone: true }),
    createdBy: createdBy(),
    ...timestamps(),
  },
  (t) => [index().on(t.orderId)],
).enableRLS();
