// Fixture untuk test yang memakai Supabase & database sungguhan.
// Semua data dibuat dengan prefix unik per run dan dihapus di cleanup().
// Password test dibuat acak di memori dan tidak pernah dicetak.

import { randomBytes } from "node:crypto";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";

import { createDatabase } from "@/db/client";
import {
  auditLogs,
  brands,
  companies,
  outlets,
  roles,
  userRoles,
  users,
} from "@/db/schema";
import { seedInitialData } from "@/db/seed";
import { loadCurrentUser, type CurrentUser } from "@/lib/auth/access";
import type { RoleCode } from "@/lib/auth/rbac";

const hasCredentials = Boolean(
  process.env.DATABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
);
// @supabase/supabase-js butuh WebSocket native (Node 22+).
const nodeSupported = Number(process.versions.node.split(".")[0]) >= 22;

if (!hasCredentials) {
  console.warn("[test] Test live dilewati: kredensial Supabase/DB belum ada di .env.local.");
} else if (!nodeSupported) {
  console.warn(`[test] Test live dilewati: butuh Node 22+ (sekarang ${process.versions.node}).`);
}

export const hasLiveEnv = hasCredentials && nodeSupported;

export type TestCompany = Awaited<ReturnType<LiveContext["createCompany"]>>;
export type TestUser = Awaited<ReturnType<LiveContext["createUser"]>>;
export type LiveContext = ReturnType<typeof createLiveContext>;

export function createLiveContext() {
  const { db, client } = createDatabase(process.env.DATABASE_URL!, { max: 3 });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = randomBytes(4).toString("hex");
  const emailPrefix = `sudaya-test-${runId}-`;
  const companyIds: string[] = [];

  const newEmail = () => `${emailPrefix}${randomBytes(3).toString("hex")}@example.com`;

  async function createCompany(label: string) {
    const code = `test-${runId}-${label}`;
    const target = {
      company: { code, name: `Test Company ${label.toUpperCase()}` },
      brand: { code: `${code}-brand`, name: `Test Brand ${label.toUpperCase()}` },
      outlet: { code: `T${runId}${label}`.toUpperCase(), name: `Test Outlet ${label.toUpperCase()}` },
    };
    await seedInitialData(db, target);
    const [company] = await db.select().from(companies).where(eq(companies.code, code));
    companyIds.push(company.id);
    const [outlet] = await db.select().from(outlets).where(eq(outlets.companyId, company.id));
    const roleRows = await db
      .select({ id: roles.id, code: roles.code })
      .from(roles)
      .where(eq(roles.companyId, company.id));
    const roleId = (roleCode: string) => {
      const role = roleRows.find((r) => r.code === roleCode);
      if (!role) throw new Error(`role ${roleCode} tidak ada`);
      return role.id;
    };
    return { id: company.id, code, name: company.name, outletId: outlet.id, target, roleId };
  }

  /** Membuat akun Supabase Auth + user aplikasi dengan role tertentu. */
  async function createUser(
    company: { id: string; outletId: string; roleId: (code: string) => string },
    assignments: { role: RoleCode | string; outlet?: "company" | "outlet" }[],
    options: { withPassword?: boolean; fullName?: string } = {},
  ) {
    const email = newEmail();
    const password = options.withPassword
      ? `${randomBytes(18).toString("base64url")}aA1!`
      : undefined;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("createUser gagal");
    const id = data.user.id;
    const fullName = options.fullName ?? `Test ${assignments.map((a) => a.role).join("+")} ${randomBytes(2).toString("hex")}`;

    await db.insert(users).values({ id, companyId: company.id, fullName });
    for (const a of assignments) {
      await db.insert(userRoles).values({
        userId: id,
        roleId: company.roleId(a.role),
        outletId: a.outlet === "outlet" ? company.outletId : null,
      });
    }
    const load = async (): Promise<CurrentUser> => (await loadCurrentUser(db, id))!;
    return { id, email, password, fullName, load, current: await load() };
  }

  /** Membuat akun Supabase Auth saja (tanpa user aplikasi). */
  async function createAuthOnly() {
    const { data, error } = await admin.auth.admin.createUser({
      email: newEmail(),
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("createUser gagal");
    return data.user.id;
  }

  /** Akun Supabase Auth dengan password, tanpa user aplikasi (bukan staf). */
  async function createAuthAccount() {
    const email = newEmail();
    const password = `${randomBytes(18).toString("base64url")}aA1!`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("createUser gagal");
    return { id: data.user.id, email, password };
  }

  async function cleanup() {
    try {
      if (companyIds.length) {
        await db.delete(auditLogs).where(inArray(auditLogs.companyId, companyIds));
      }
      const testAuthUsers = await db
        .select({ id: authUsers.id })
        .from(authUsers)
        .where(like(authUsers.email, `${emailPrefix}%`));
      for (const user of testAuthUsers) {
        // ON DELETE CASCADE ke public.users → user_roles.
        await admin.auth.admin.deleteUser(user.id);
      }
      if (companyIds.length) {
        await db.delete(users).where(inArray(users.companyId, companyIds));
        await db.delete(roles).where(inArray(roles.companyId, companyIds));
        await db.delete(outlets).where(inArray(outlets.companyId, companyIds));
        await db.delete(brands).where(inArray(brands.companyId, companyIds));
        await db.delete(companies).where(inArray(companies.id, companyIds));
      }
    } finally {
      await client.end();
    }
  }

  async function countAudit(companyId: string, action: string, entityId?: string) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.companyId, companyId),
          eq(auditLogs.action, action),
          entityId ? eq(auditLogs.entityId, entityId) : undefined,
        ),
      );
    return row.n;
  }

  return {
    db,
    admin,
    runId,
    newEmail,
    createCompany,
    createUser,
    createAuthOnly,
    createAuthAccount,
    countAudit,
    cleanup,
  };
}

/** Login ke Supabase Auth dan simpan cookie session seperti browser. */
export async function signInWithCookies(email: string, password: string) {
  const jar = new Map<string, string>();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll(cookies) {
          for (const { name, value, options } of cookies) {
            if (!value || options?.maxAge === 0) jar.delete(name);
            else jar.set(name, value);
          }
        },
      },
    },
  );
  const result = await supabase.auth.signInWithPassword({ email, password });
  return {
    supabase,
    jar,
    error: result.error,
    session: result.data.session,
    cookieHeader: () => [...jar].map(([n, v]) => `${n}=${v}`).join("; "),
  };
}
