import { readFileSync } from "node:fs";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { approvals, attendances, outsideDutyRequests } from "@/db/schema";
import { createEmployee } from "@/lib/attendance/employees";
import { requestOutsideDuty, updateOutletGeofence } from "@/lib/attendance/engine";
import { businessDateIn } from "@/lib/orders/dates";

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
const audit = { ip: "127.0.0.1", userAgent: "vitest" };
const isForbidden = (body: string) => /<meta name="robots" content="noindex"/.test(body);
const ATTENDANCE_ACTIONS = "src/lib/attendance/actions.ts";

async function get(path: string, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.text(), headers: res.headers };
}

function actionId(exportedName: string) {
  const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as {
    node: Record<string, { filename: string; exportedName: string }>;
  };
  const entry = Object.entries(manifest.node).find(([, v]) => v.filename === ATTENDANCE_ACTIONS && v.exportedName === exportedName);
  if (!entry) throw new Error(`action ${exportedName} tidak ditemukan`);
  return entry[0];
}

async function callAction(path: string, name: string, args: unknown[], cookie?: string) {
  const headers: Record<string, string> = {
    "Next-Action": actionId(name),
    Accept: "text/x-component",
    Origin: BASE,
    "Content-Type": "text/plain;charset=UTF-8",
  };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE}${path}`, { method: "POST", redirect: "manual", headers, body: JSON.stringify(args) });
  const body = await res.text();
  const line = body.split("\n").find((l) => /^1:\{/.test(l));
  return line ? JSON.parse(line.slice(2)) : { ok: false, raw: body.slice(0, 200), status: res.status };
}

describe.skipIf(!hasLiveEnv)("absensi end-to-end (provider belum dikonfigurasi)", () => {
  let ctx: LiveContext;
  let company: TestCompany;
  let manager: TestUser;
  let barista: TestUser;
  let cashier: TestUser;
  const cookies: Record<string, string> = {};
  let baristaEmployee: string;
  const yesterday = () => new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

  beforeAll(async () => {
    ctx = createLiveContext();
    company = await ctx.createCompany("e2eatt");
    const admin = await ctx.createUser(company, [{ role: "super_admin" }]);
    manager = await ctx.createUser(company, [{ role: "manager", outlet: "outlet" }], { withPassword: true, fullName: "E2E Manager" });
    barista = await ctx.createUser(company, [{ role: "barista", outlet: "outlet" }], { withPassword: true, fullName: "E2E Barista Absensi" });
    cashier = await ctx.createUser(company, [{ role: "cashier", outlet: "outlet" }], { withPassword: true, fullName: "E2E Kasir" });
    for (const [name, user] of Object.entries({ manager, barista, cashier })) {
      cookies[name] = (await signInWithCookies(user.email, user.password!)).cookieHeader();
    }
    const link = async (user: TestUser, code: string) =>
      (await createEmployee(ctx.db, admin.current, { employeeCode: `${code}-${ctx.runId}`, fullName: user.fullName, outletId: company.outletId, userId: user.id, position: "Barista" }, audit))!.id;
    baristaEmployee = await link(barista, "BAR");
    await link(manager, "MGR");
    await updateOutletGeofence(ctx.db, admin.current, { outletId: company.outletId, latitude: -6.2, longitude: 106.816666, radiusMeter: 5 }, audit);
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });

  it("akses halaman: staf absensi, admin sesuai permission", async () => {
    expect((await get("/staff/attendance")).status).toBe(307);
    const staff = await get("/staff/attendance", cookies.barista);
    expect(isForbidden(staff.body)).toBe(false);
    expect(staff.body).toContain("Layanan verifikasi wajah belum dikonfigurasi");
    expect(staff.body).toContain("koreksi absensi");
    const enrollment = await get("/staff/face-enrollment", cookies.barista);
    expect(enrollment.body).toContain("Pemberitahuan privasi data biometrik");
    expect(enrollment.body).toContain("Belum dikonfigurasi");
    expect((await get("/staff", cookies.barista)).body).toContain('href="/staff/attendance"');

    expect(isForbidden((await get("/admin/attendance", cookies.barista)).body)).toBe(true);
    expect(isForbidden((await get("/admin/employees", cookies.barista)).body)).toBe(true);
    const dashboard = await get("/admin/attendance", cookies.manager);
    expect(isForbidden(dashboard.body)).toBe(false);
    expect(dashboard.body).toContain("E2E Barista Absensi");
    expect(dashboard.body).toContain("Belum check-in");
    expect(isForbidden((await get("/admin/attendance/settings", cookies.manager)).body)).toBe(true);
    const employees = await get("/admin/employees", cookies.manager);
    expect(employees.body).toContain(`BAR-${ctx.runId}`.toUpperCase());
    // Kasir tanpa data karyawan: halaman absensi menjelaskan, bukan error.
    expect((await get("/staff/attendance", cookies.cashier)).body).toContain("Akun belum terhubung ke data karyawan");
  });

  it("provider belum dikonfigurasi: tidak ada absensi biometrik yang bisa berhasil lewat HTTP", async () => {
    const session = await callAction("/staff/attendance", "startFaceSessionAction", [{ purpose: "check_in" }], cookies.barista);
    expect(session).toMatchObject({ ok: false });
    expect(session.error).toMatch(/belum dikonfigurasi/);
    const forged = await callAction(
      "/staff/attendance",
      "checkInAction",
      [{ sessionId: crypto.randomUUID(), position: { latitude: -6.2, longitude: 106.816666, accuracy: 3, ageMs: 100 } }],
      cookies.barista,
    );
    expect(forged).toMatchObject({ ok: false });
    const consent = await callAction("/staff/face-enrollment", "giveConsentAction", [{ noticeVersion: "2026-10-30", agree: true }], cookies.barista);
    expect(consent).toMatchObject({ ok: false });
    // Pratinjau lokasi tetap dihitung server.
    const location = await callAction(
      "/staff/attendance",
      "checkLocationAction",
      [{ position: { latitude: -6.2 + 30 / 111_320, longitude: 106.816666, accuracy: 4, ageMs: 100 } }],
      cookies.barista,
    );
    expect(location).toMatchObject({ ok: true, data: { ok: false, reason: "outside_radius", radiusMeter: 5 } });
    const rows = await ctx.db.select().from(attendances).where(eq(attendances.employeeId, baristaEmployee));
    expect(rows).toHaveLength(0);
  });

  it("koreksi manual: diajukan staf, disetujui manager lain, berlabel koreksi manual", async () => {
    const day = yesterday();
    const request = await callAction(
      "/staff/attendance/correction",
      "requestCorrectionAction",
      [{ kind: "missing_attendance", checkInAt: `${day}T08:00`, checkOutAt: `${day}T16:00`, reason: "Layanan verifikasi belum tersedia" }],
      cookies.barista,
    );
    expect(request).toMatchObject({ ok: true });
    const [approval] = await ctx.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.companyId, company.id), eq(approvals.type, "attendance_correction"), eq(approvals.status, "pending")));
    // Barista tidak berwenang; manager (bukan pemohon) menyetujui.
    expect(await callAction("/admin/attendance", "decideCorrectionAction", [{ approvalId: approval.id, approve: true }], cookies.barista)).toMatchObject({ ok: false });
    expect(await callAction("/admin/attendance", "decideCorrectionAction", [{ approvalId: approval.id, approve: true }], cookies.manager)).toMatchObject({ ok: true });
    const [row] = await ctx.db.select().from(attendances).where(eq(attendances.employeeId, baristaEmployee));
    expect(row).toMatchObject({ checkInMethod: "manual_correction", checkOutMethod: "manual_correction", workingMinutes: 480 });
    const history = await get(`/staff/attendance/history?month=${day.slice(0, 7)}`, cookies.barista);
    expect(history.body).toContain("Koreksi manual (disetujui)");
    expect(history.body).not.toContain("Terverifikasi biometrik</");

    // Manager mengajukan untuk dirinya sendiri → tidak bisa menyetujui sendiri.
    await callAction(
      "/staff/attendance/correction",
      "requestCorrectionAction",
      [{ kind: "missing_attendance", checkInAt: `${day}T09:00`, checkOutAt: `${day}T12:00`, reason: "Lupa absen pagi" }],
      cookies.manager,
    );
    const [own] = await ctx.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.companyId, company.id), eq(approvals.status, "pending"), eq(approvals.requestedBy, manager.id)));
    const self = await callAction("/admin/attendance", "decideCorrectionAction", [{ approvalId: own.id, approve: true }], cookies.manager);
    expect(self).toMatchObject({ ok: false });
    expect(self.error).toMatch(/sendiri/);
  });

  it("tugas luar: approval manager lewat HTTP, status tampil ke karyawan", async () => {
    const created = await requestOutsideDuty(
      ctx.db,
      barista.current,
      { dutyDate: businessDateIn("Asia/Jakarta"), startTime: "00:00", endTime: "23:59", location: "Supplier susu", purpose: "Ambil stok", notes: "Stok susu habis" },
      null,
      { upload: async () => {}, remove: async () => {}, signedUrl: async () => "" },
      audit,
    );
    const list = await get("/admin/outside-duty", cookies.manager);
    expect(list.body).toContain("Supplier susu");
    expect(await callAction("/admin/outside-duty", "decideOutsideDutyAction", [{ approvalId: created.approvalId, approve: true }], cookies.manager)).toMatchObject({ ok: true });
    const [request] = await ctx.db.select().from(outsideDutyRequests).where(eq(outsideDutyRequests.id, created.requestId));
    expect(request.approvalId).toBe(created.approvalId);
    const staffPage = await get("/staff/outside-duty", cookies.barista);
    expect(staffPage.body).toContain("Disetujui");
    expect(staffPage.body).toContain("Supplier susu");
  });

  it("laporan CSV / Excel: hanya pemegang report.attendance, ekspor tercatat di audit", async () => {
    const day = yesterday();
    const range = `from=${day}&to=${businessDateIn("Asia/Jakarta")}`;
    const csv = await fetch(`${BASE}/admin/attendance/reports/export?${range}&format=csv`, { headers: { cookie: cookies.manager } });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    // Response.text() membuang BOM → cek byte mentah.
    const bytes = new Uint8Array(await csv.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith("Employee,Employee ID,Outlet,Tanggal")).toBe(true);
    expect(text).toContain("E2E Barista Absensi");
    expect(text).toContain("Koreksi manual (disetujui)");
    const excel = new Uint8Array(await (await fetch(`${BASE}/admin/attendance/reports/export?${range}&format=excel`, { headers: { cookie: cookies.manager } })).arrayBuffer());
    expect([...excel.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(excel).startsWith("sep=;")).toBe(true);

    const denied = await fetch(`${BASE}/admin/attendance/reports/export?${range}`, { headers: { cookie: cookies.barista }, redirect: "manual" });
    expect(denied.status).toBe(403);
    expect((await fetch(`${BASE}/admin/attendance/reports/export?${range}`, { redirect: "manual" })).status).toBe(307);
    expect(await ctx.countAudit(company.id, "attendance.report_exported")).toBe(2);
    const page = await get(`/admin/attendance/reports?${range}`, cookies.manager);
    expect(page.body).toContain("Tugas luar disetujui");
  });
});
