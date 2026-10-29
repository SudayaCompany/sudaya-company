import {
  date,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

import { id, money, timestamps } from "./columns";
import { companies } from "./tenancy";

/** PRD §51 — customer level company. Login opsional (PRD §32). */
export const customers = pgTable(
  "customers",
  {
    id: id(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id),
    authUserId: uuid()
      .unique()
      .references(() => authUsers.id, { onDelete: "set null" }),
    name: text().notNull(),
    phone: text(),
    email: text(),
    birthday: date(),
    totalTransactions: integer().notNull().default(0),
    totalSpending: money().notNull().default(0),
    lastTransactionAt: timestamp({ withTimezone: true }),
    /** PRD §83 — consent & mekanisme hapus akun. */
    consentAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [unique().on(t.companyId, t.phone)],
).enableRLS();
