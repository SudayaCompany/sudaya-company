import {
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { id, money, timestamps } from "./columns";
import { modifiers, products } from "./catalog";
import { customers } from "./customers";
import { orderChannel, orderStatus, orderType, paymentStatus } from "./enums";
import { createdBy } from "./identity";
import { outlets, tenantColumns } from "./tenancy";

/**
 * PRD §37 — counter nomor antrean harian per outlet. Dinaikkan dengan
 * INSERT ... ON CONFLICT DO UPDATE ... RETURNING agar atomik.
 */
export const orderNumberCounters = pgTable(
  "order_number_counters",
  {
    outletId: uuid()
      .notNull()
      .references(() => outlets.id),
    businessDate: date().notNull(),
    lastNumber: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.outletId, t.businessDate] })],
).enableRLS();

export const orders = pgTable(
  "orders",
  {
    id: id(),
    ...tenantColumns(),
    channel: orderChannel().notNull(),
    type: orderType().notNull(),
    status: orderStatus().notNull().default("draft"),
    paymentStatus: paymentStatus().notNull().default("pending"),

    /**
     * Nomor (SDY-001) diberikan saat order masuk antrean, yaitu setelah
     * dibayar, supaya urutan nomor = urutan antrean (PRD §36, §120-D).
     */
    businessDate: date(),
    queueNumber: integer(),
    orderNumber: text(),

    /** PRD §102 — mencegah double click membuat dua order. */
    idempotencyKey: text().notNull(),

    customerId: uuid().references(() => customers.id),
    customerName: text(),
    customerPhone: text(),
    tableNumber: text(),
    locationNote: text(),
    deliveryAddress: text(),
    notes: text(),

    subtotal: money().notNull(),
    discountTotal: money().notNull().default(0),
    total: money().notNull(),

    /** Kunci urutan antrean FIFO (PRD §36, §40). */
    paidAt: timestamp({ withTimezone: true }),
    preparingAt: timestamp({ withTimezone: true }),
    readyAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelReason: text(),

    /** null untuk order customer guest. */
    createdBy: createdBy(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.outletId, t.idempotencyKey),
    unique().on(t.outletId, t.businessDate, t.queueNumber),
    index().on(t.outletId, t.status, t.paidAt),
    index().on(t.customerId),
  ],
).enableRLS();

/** Nama & harga disalin saat order dibuat agar riwayat tidak berubah. */
export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    productName: text().notNull(),
    unitPrice: money().notNull(),
    quantity: integer().notNull(),
    modifiersTotal: money().notNull().default(0),
    lineTotal: money().notNull(),
    notes: text(),
  },
  (t) => [index().on(t.orderId)],
).enableRLS();

export const orderItemModifiers = pgTable(
  "order_item_modifiers",
  {
    id: id(),
    orderItemId: uuid()
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    modifierId: uuid().references(() => modifiers.id, {
      onDelete: "set null",
    }),
    groupName: text().notNull(),
    modifierName: text().notNull(),
    priceDelta: money().notNull(),
  },
  (t) => [index().on(t.orderItemId)],
).enableRLS();
