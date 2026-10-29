import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, timestamps } from "./columns";
import { approvalStatus, approvalType } from "./enums";
import { users } from "./identity";
import { brands, companies, outlets, tenantColumns } from "./tenancy";

/**
 * PRD §69 — kotak approval tunggal. Tabel domain (refund, opname, tugas
 * luar) menyimpan approvalId; status keputusan hanya ada di sini.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    ...tenantColumns(),
    type: approvalType().notNull(),
    /** Id baris di tabel domain sesuai `type`. */
    referenceId: uuid().notNull(),
    status: approvalStatus().notNull().default("pending"),
    reason: text().notNull(),
    requestedBy: uuid()
      .notNull()
      .references(() => users.id),
    decidedBy: uuid().references(() => users.id),
    decisionNote: text(),
    decidedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index().on(t.outletId, t.status),
    index().on(t.type, t.referenceId),
  ],
).enableRLS();

/**
 * PRD §71–72 — log append-only. Outlet/brand boleh kosong untuk event
 * level company (mis. login, ubah user).
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id),
    brandId: uuid().references(() => brands.id),
    outletId: uuid().references(() => outlets.id),
    actorId: uuid().references(() => users.id),
    /** mis. auth.login, stock.adjust, order.void, product.price_change */
    action: text().notNull(),
    entityType: text(),
    entityId: uuid(),
    before: jsonb(),
    after: jsonb(),
    reason: text(),
    ip: text(),
    userAgent: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.entityType, t.entityId),
    index().on(t.companyId, t.createdAt),
  ],
).enableRLS();
