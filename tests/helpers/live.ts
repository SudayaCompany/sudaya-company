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
  approvals,
  auditLogs,
  brands,
  categories,
  companies,
  inventoryAdjustments,
  inventoryItems,
  inventoryTransactions,
  modifierGroups,
  orderNumberCounters,
  orders,
  outlets,
  payments,
  productRecipeItems,
  products,
  rateLimitCounters,
  refunds,
  roles,
  stockOpnames,
  userRoles,
  users,
} from "@/db/schema";
import { seedInitialData } from "@/db/seed";
import { loadCurrentUser, type CurrentUser } from "@/lib/auth/access";
import type { RoleCode } from "@/lib/auth/rbac";
import { MENU_IMAGE_BUCKET } from "@/lib/catalog/image-url";
import { EVIDENCE_BUCKET } from "@/lib/inventory/evidence-types";
import { rateLimitKeyHash } from "@/lib/security/rate-limit";

/** PNG 1×1 yang valid, untuk test upload foto. */
export const TINY_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
);

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
  /** Key rate limit yang dipakai test (dihapus persis, bukan pola). */
  const rateLimitKeys = new Set<string>();
  const trackRateLimitKey = (key: string) => rateLimitKeys.add(rateLimitKeyHash(key));

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
    return {
      id: company.id,
      code,
      name: company.name,
      brandId: outlet.brandId,
      outletId: outlet.id,
      outletCode: outlet.code,
      target,
      roleId,
    };
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
        // Data transaksi merujuk users (created_by/confirmed_by/requested_by),
        // jadi dihapus sebelum akun Auth. order_items ikut cascade.
        await db.delete(refunds).where(inArray(refunds.companyId, companyIds));
        await db.delete(payments).where(inArray(payments.companyId, companyIds));
        // Inventory (merujuk approvals & users). Ledger append-only: DELETE
        // hanya diizinkan dengan flag maintenance di transaksi yang sama, dan
        // dibatasi ke company test run ini.
        await db.delete(inventoryAdjustments).where(inArray(inventoryAdjustments.companyId, companyIds));
        await db.delete(stockOpnames).where(inArray(stockOpnames.companyId, companyIds));
        await db.transaction(async (tx) => {
          await tx.execute(sql`select set_config('sudaya.ledger_maintenance', 'on', true)`);
          await tx.delete(inventoryTransactions).where(inArray(inventoryTransactions.companyId, companyIds));
        });
        await db.delete(approvals).where(inArray(approvals.companyId, companyIds));
        await db.delete(orders).where(inArray(orders.companyId, companyIds));
        await db
          .delete(orderNumberCounters)
          .where(
            inArray(
              orderNumberCounters.outletId,
              db.select({ id: outlets.id }).from(outlets).where(inArray(outlets.companyId, companyIds)),
            ),
          );
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
        // Foto menu test di Storage: <companyId>/<brandId>/<file>.
        for (const companyId of companyIds) {
          const { data: folders } = await admin.storage.from(MENU_IMAGE_BUCKET).list(companyId);
          for (const folder of folders ?? []) {
            const { data: files } = await admin.storage
              .from(MENU_IMAGE_BUCKET)
              .list(`${companyId}/${folder.name}`);
            const paths = (files ?? []).map((f) => `${companyId}/${folder.name}/${f.name}`);
            if (paths.length) await admin.storage.from(MENU_IMAGE_BUCKET).remove(paths);
          }
          // Bukti foto inventory: <companyId>/<outletId>/<file>.
          const { data: evidenceFolders } = await admin.storage.from(EVIDENCE_BUCKET).list(companyId);
          for (const folder of evidenceFolders ?? []) {
            const { data: files } = await admin.storage
              .from(EVIDENCE_BUCKET)
              .list(`${companyId}/${folder.name}`);
            const paths = (files ?? []).map((f) => `${companyId}/${folder.name}/${f.name}`);
            if (paths.length) await admin.storage.from(EVIDENCE_BUCKET).remove(paths);
          }
        }
        // Katalog dulu (FK ke brand/outlet); cascade ke outlet_products,
        // product_modifier_groups, dan modifiers.
        await db.delete(productRecipeItems).where(inArray(productRecipeItems.companyId, companyIds));
        await db.delete(products).where(inArray(products.companyId, companyIds));
        await db.delete(modifierGroups).where(inArray(modifierGroups.companyId, companyIds));
        await db.delete(categories).where(inArray(categories.companyId, companyIds));
        // Setelah products (cascade outlet_products yang merujuk item).
        await db.delete(inventoryItems).where(inArray(inventoryItems.companyId, companyIds));
        await db.delete(users).where(inArray(users.companyId, companyIds));
        await db.delete(roles).where(inArray(roles.companyId, companyIds));
        await db.delete(outlets).where(inArray(outlets.companyId, companyIds));
        await db.delete(brands).where(inArray(brands.companyId, companyIds));
        await db.delete(companies).where(inArray(companies.id, companyIds));
      }
      if (rateLimitKeys.size) {
        await db.delete(rateLimitCounters).where(inArray(rateLimitCounters.key, [...rateLimitKeys]));
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
    trackRateLimitKey,
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
