import type { DbExecutor } from "@/db/client";
import { auditLogs } from "@/db/schema";

/** Konteks request untuk audit. Jangan pernah isi dengan token/cookie. */
export type AuditContext = {
  ip?: string | null;
  userAgent?: string | null;
};

export type AuditEntry = {
  companyId: string;
  brandId?: string | null;
  outletId?: string | null;
  /** null = sistem / CLI. */
  actorId: string | null;
  /** mis. auth.login, rbac.role_assigned, user.status_changed */
  action: string;
  entityType?: string;
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
};

export async function recordAudit(
  db: DbExecutor,
  entry: AuditEntry,
  context: AuditContext = {},
) {
  await db.insert(auditLogs).values({
    ...entry,
    ip: context.ip?.slice(0, 64) ?? null,
    userAgent: context.userAgent?.slice(0, 512) ?? null,
  });
}
