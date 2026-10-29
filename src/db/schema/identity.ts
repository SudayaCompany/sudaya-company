import {
  boolean,
  date,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

import { id, timestamps } from "./columns";
import { companies, outlets, tenantColumns } from "./tenancy";

/** Akun login staf. Id = auth.users.id dari Supabase Auth. */
export const users = pgTable("users", {
  id: uuid()
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  companyId: uuid()
    .notNull()
    .references(() => companies.id),
  fullName: text().notNull(),
  phone: text(),
  isActive: boolean().notNull().default(true),
  ...timestamps(),
}).enableRLS();

/** User yang membuat baris (PRD §119). Nullable untuk aksi customer guest. */
export const createdBy = () => uuid().references(() => users.id);

// PRD §80 — RBAC.

export const roles = pgTable(
  "roles",
  {
    id: id(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id),
    /** super_admin, owner, manager, admin, barista, kasir */
    code: text().notNull(),
    name: text().notNull(),
    ...timestamps(),
  },
  (t) => [unique().on(t.companyId, t.code)],
).enableRLS();

export const permissions = pgTable("permissions", {
  /** mis. product.view, order.void, stock.adjust */
  code: text().primaryKey(),
  description: text(),
}).enableRLS();

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionCode: text()
      .notNull()
      .references(() => permissions.code, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionCode] })],
).enableRLS();

export const userRoles = pgTable(
  "user_roles",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    /** null = berlaku di semua outlet. */
    outletId: uuid().references(() => outlets.id, { onDelete: "cascade" }),
  },
  (t) => [unique().on(t.userId, t.roleId, t.outletId).nullsNotDistinct()],
).enableRLS();

/** Profil karyawan. outletId = outlet utama tempat absensi. */
export const employees = pgTable(
  "employees",
  {
    id: id(),
    ...tenantColumns(),
    userId: uuid()
      .unique()
      .references(() => users.id, { onDelete: "set null" }),
    employeeCode: text().notNull(),
    fullName: text().notNull(),
    phone: text(),
    position: text(),
    joinedAt: date(),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [unique().on(t.companyId, t.employeeCode)],
).enableRLS();
