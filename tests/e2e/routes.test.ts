import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLogs, userRoles, users } from "@/db/schema";

import {
  createLiveContext,
  hasLiveEnv,
  signInWithCookies,
  type LiveContext,
  type TestCompany,
  type TestUser,
} from "../helpers/live";
import { E2E_PORT } from "./global-setup";

const BASE = `http://localhost:${E2E_PORT}`;

/**
 * Next.js menyuntikkan meta noindex hanya saat forbidden() dipanggil.
 * Teks "Access Denied" tidak bisa dipakai karena UI fallback 403 ikut
 * terserialisasi di payload RSC setiap halaman.
 */
const isForbidden = (body: string) =>
  /<meta name="robots" content="noindex"/.test(body);

async function get(path: string, cookie?: string) {
  const response = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
    body: await response.text(),
  };
}

/** ID Server Action dari manifest build (sama seperti yang dipakai browser). */
function actionId(filename: string, exportedName: string) {
  const manifest = JSON.parse(
    readFileSync(".next/server/server-reference-manifest.json", "utf8"),
  ) as { node: Record<string, { filename: string; exportedName: string }> };
  const entry = Object.entries(manifest.node).find(
    ([, v]) => v.filename === filename && v.exportedName === exportedName,
  );
  if (!entry) throw new Error(`action ${exportedName} tidak ditemukan`);
  return entry[0];
}

/** Memanggil Server Action langsung via HTTP, melewati UI. */
async function callAction(
  path: string,
  id: string,
  body: BodyInit,
  cookie?: string,
  contentType = "text/plain;charset=UTF-8",
) {
  const headers: Record<string, string> = {
    "Next-Action": id,
    Accept: "text/x-component",
    Origin: BASE,
  };
  if (contentType) headers["Content-Type"] = contentType;
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers,
    body,
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.text(),
  };
}

/** Argumen (prevState, FormData) untuk action useActionState (format React). */
function loginBody(email: string, password: string) {
  // Entri FormData harus mendahului root "0" (server men-decode secara stream).
  const form = new FormData();
  form.append("_1_email", email);
  form.append("_1_password", password);
  form.append("0", JSON.stringify([{}, "$K1"]));
  return form;
}

describe.skipIf(!hasLiveEnv)("route & session end-to-end", () => {
  let ctx: LiveContext;
  let company: TestCompany;
  let superAdmin: TestUser;
  let barista: TestUser;
  let cashier: TestUser;

  beforeAll(async () => {
    ctx = createLiveContext();
    company = await ctx.createCompany("e2e");
    superAdmin = await ctx.createUser(company, [{ role: "super_admin" }], {
      withPassword: true,
      fullName: "E2E Super Admin",
    });
    barista = await ctx.createUser(company, [{ role: "barista", outlet: "outlet" }], {
      withPassword: true,
      fullName: "E2E Barista",
    });
    cashier = await ctx.createUser(company, [{ role: "cashier", outlet: "outlet" }], {
      withPassword: true,
      fullName: "E2E Kasir",
    });
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });

  describe("guest", () => {
    it("1. membuka /order → berhasil", async () => {
      const res = await get("/order");
      expect(res.status).toBe(200);
      expect(res.body).toContain("Sudaya Order");
    });

    it("/kiosk publik dan tidak menautkan area staff/admin", async () => {
      const res = await get("/kiosk");
      expect(res.status).toBe(200);
      expect(res.body).not.toMatch(/href="\/(admin|staff|kds)/);
    });

    it("2. membuka /admin → redirect ke /login?next=/admin", async () => {
      const res = await get("/admin");
      expect(res.status).toBe(307);
      expect(res.location).toMatch(/\/login\?next=%2Fadmin$/);
    });

    it("/staff dan /kds juga wajib login", async () => {
      expect((await get("/staff")).status).toBe(307);
      expect((await get("/kds")).status).toBe(307);
    });

    it("12. Server Action admin tanpa session ditolak (proxy & DAL)", async () => {
      const id = actionId("src/app/admin/users/actions.ts", "setUserActiveAction");
      const args = JSON.stringify([{ userId: barista.id, isActive: false }]);

      // Tanpa cookie: diblokir proxy sebelum action berjalan.
      const guest = await callAction("/admin/users", id, args);
      expect(guest.status).toBe(307);

      // Halaman publik tidak memuat action admin → tidak dieksekusi.
      const viaPublic = await callAction("/order", id, args);
      expect(viaPublic.body).not.toContain('"ok":true');

      // JWT Supabase valid (lolos proxy) tapi bukan staf → ditolak DAL.
      const outsider = await ctx.createAuthAccount();
      const { cookieHeader } = await signInWithCookies(outsider.email, outsider.password);
      const res = await callAction("/admin/users", id, args, cookieHeader());
      expect(res.body).toContain("Sesi berakhir");

      const [row] = await ctx.db.select({ isActive: users.isActive }).from(users).where(eq(users.id, barista.id));
      expect(row.isActive).toBe(true);
    });
  });

  describe("login lewat Server Action aplikasi", () => {
    const loginId = () => actionId("src/app/login/actions.ts", "login");

    it("3. password salah → pesan error, tanpa session", async () => {
      const res = await callAction("/login", loginId(), loginBody(barista.email, "salah-total-123"), undefined, "");
      expect(res.body).toContain("Email atau password salah.");
      expect(res.headers.get("set-cookie") ?? "").not.toMatch(/auth-token=base64/);
    });

    it("4. login valid → cookie session terbentuk, redirect sesuai role, audit tercatat", async () => {
      const res = await callAction("/login", loginId(), loginBody(barista.email, barista.password!), undefined, "");
      expect(res.headers.get("set-cookie") ?? "").toMatch(/sb-[a-z0-9]+-auth-token/);
      expect(res.headers.get("x-action-redirect") ?? "").toMatch(/^\/staff/);
      const logins = await ctx.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "auth.login"), eq(auditLogs.actorId, barista.id)));
      expect(logins.length).toBe(1);
    });
  });

  describe("akses berdasarkan role (session Supabase sungguhan)", () => {
    it("4b. login valid via Supabase → cookie auth-token tersimpan", async () => {
      const session = await signInWithCookies(superAdmin.email, superAdmin.password!);
      expect(session.error).toBeNull();
      expect([...session.jar.keys()].some((k) => /auth-token/.test(k))).toBe(true);
    });

    it("3b. Supabase menolak password salah", async () => {
      const session = await signInWithCookies(superAdmin.email, "bukan-password-ini");
      expect(session.error?.code).toBe("invalid_credentials");
    });

    it("5. Super Admin → dashboard admin & halaman pengguna", async () => {
      const { cookieHeader } = await signInWithCookies(superAdmin.email, superAdmin.password!);
      const dashboard = await get("/admin", cookieHeader());
      expect(dashboard.status).toBe(200);
      expect(dashboard.body).toContain("Halo, E2E Super Admin");
      expect(dashboard.body).toContain(company.name);
      expect(isForbidden(dashboard.body)).toBe(false);

      const usersPage = await get("/admin/users", cookieHeader());
      expect(usersPage.body).toContain(barista.email);
    });

    it("6. Barista → halaman admin ditolak (403)", async () => {
      const { cookieHeader } = await signInWithCookies(barista.email, barista.password!);
      for (const path of ["/admin", "/admin/users", "/admin/roles", "/admin/audit"]) {
        const res = await get(path, cookieHeader());
        expect(isForbidden(res.body), path).toBe(true);
        expect(res.body, path).not.toContain("Halo, ");
      }
    });

    it("7. Barista → /staff berhasil", async () => {
      const { cookieHeader } = await signInWithCookies(barista.email, barista.password!);
      const res = await get("/staff", cookieHeader());
      expect(res.status).toBe(200);
      expect(res.body).toContain("Selamat bertugas");
      expect(res.body).toContain("E2E Barista");
    });

    it("Barista → /kds berhasil (punya kds.view)", async () => {
      const { cookieHeader } = await signInWithCookies(barista.email, barista.password!);
      const res = await get("/kds", cookieHeader());
      expect(isForbidden(res.body)).toBe(false);
      expect(res.body).toContain("Antrean FIFO");
    });

    it("8. Kasir tanpa kds.view → /kds 403", async () => {
      const { cookieHeader } = await signInWithCookies(cashier.email, cashier.password!);
      const res = await get("/kds", cookieHeader());
      expect(isForbidden(res.body)).toBe(true);
      expect(res.body).not.toContain("Antrean FIFO");
    });

    it("12. Barista memanggil Server Action admin langsung → ditolak", async () => {
      const { cookieHeader } = await signInWithCookies(barista.email, barista.password!);

      const suspend = await callAction(
        "/admin/users",
        actionId("src/app/admin/users/actions.ts", "setUserActiveAction"),
        JSON.stringify([{ userId: cashier.id, isActive: false }]),
        cookieHeader(),
      );
      expect(suspend.body).toContain("Anda tidak memiliki izin");

      const escalate = await callAction(
        "/admin/users",
        actionId("src/app/admin/users/actions.ts", "assignRoleAction"),
        JSON.stringify([
          { userId: barista.id, roleId: company.roleId("super_admin"), outletId: null },
        ]),
        cookieHeader(),
      );
      expect(escalate.body).toMatch(/tidak memiliki izin|akun sendiri/);

      const [cashierRow] = await ctx.db.select({ isActive: users.isActive }).from(users).where(eq(users.id, cashier.id));
      expect(cashierRow.isActive).toBe(true);
      const grants = await ctx.db.select().from(userRoles).where(eq(userRoles.userId, barista.id));
      expect(grants).toHaveLength(1);
    });
  });

  describe("logout & status akun", () => {
    it("9. logout → session berakhir, cookie lama tidak berlaku lagi", async () => {
      const session = await signInWithCookies(superAdmin.email, superAdmin.password!);
      const oldCookie = session.cookieHeader();
      const refreshToken = session.session!.refresh_token;
      expect((await get("/admin", oldCookie)).body).toContain("Halo, E2E Super Admin");

      const res = await callAction(
        "/admin",
        actionId("src/lib/auth/actions.ts", "logout"),
        JSON.stringify([]),
        oldCookie,
      );
      expect(res.headers.get("x-action-redirect") ?? "").toMatch(/^\/login/);
      expect(await ctx.countAudit(company.id, "auth.logout", superAdmin.id)).toBe(1);

      // Salinan cookie lama (mis. dicuri) tidak lagi membuka halaman admin.
      const after = await get("/admin", oldCookie);
      expect(after.body).not.toContain("Halo, E2E Super Admin");

      // Refresh token sudah dicabut.
      const anon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false } },
      );
      const { error } = await anon.auth.refreshSession({ refresh_token: refreshToken });
      expect(error).not.toBeNull();
    });

    it("akun nonaktif tidak bisa membuka /staff walau session masih ada", async () => {
      const { cookieHeader } = await signInWithCookies(cashier.email, cashier.password!);
      expect((await get("/staff", cookieHeader())).body).toContain("Selamat bertugas");

      await ctx.db.update(users).set({ isActive: false }).where(eq(users.id, cashier.id));
      const res = await get("/staff", cookieHeader());
      expect(res.body).not.toContain("Selamat bertugas");

      await ctx.db.update(users).set({ isActive: true }).where(eq(users.id, cashier.id));
    });
  });
});
