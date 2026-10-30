// Unduh laporan absensi (CSV / Excel). Cek session + report.attendance;
// setiap ekspor dicatat di audit log (data pribadi karyawan keluar sistem).

import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { toCsv } from "@/lib/attendance/csv";
import { formatMinutes } from "@/lib/attendance/labels";
import { attendanceReport, CATEGORY_LABELS } from "@/lib/attendance/queries";
import { attendanceListParams } from "@/lib/attendance/schemas";
import { AccessError } from "@/lib/auth/errors";
import { getAuditContext, getCurrentUser } from "@/lib/auth/session";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !user.isActive) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const params = attendanceListParams.parse(Object.fromEntries(url.searchParams));
  const format = url.searchParams.get("format") === "excel" ? "excel" : "csv";

  let report;
  try {
    report = await attendanceReport(db, user, params);
  } catch (error) {
    if (error instanceof AccessError) {
      return new Response(error.message, { status: error.code === "forbidden" ? 403 : 400 });
    }
    throw error;
  }

  const fmt = (date: Date | null, tz: string, opts: Intl.DateTimeFormatOptions) =>
    date ? new Intl.DateTimeFormat("id-ID", { ...opts, timeZone: tz }).format(date) : "";
  const rows = [
    ["Employee", "Employee ID", "Outlet", "Tanggal", "Check-In", "Check-Out", "Total Jam", "Total Menit", "Status", "Tugas Luar", "Metode Verifikasi", "Catatan"],
    ...report.rows.map((r) => [
      r.employeeName,
      r.employeeCode,
      r.outletName,
      r.businessDate,
      fmt(r.checkInAt, r.timezone, { dateStyle: "short", timeStyle: "short" }),
      fmt(r.checkOutAt, r.timezone, { dateStyle: "short", timeStyle: "short" }),
      r.workingMinutes === null ? "" : formatMinutes(r.workingMinutes),
      r.workingMinutes,
      CATEGORY_LABELS[r.category],
      r.outsideDutyRequestId ? "Ya" : "Tidak",
      r.method,
      r.notes,
    ]),
  ];

  await recordAudit(
    db,
    {
      companyId: user.company.id,
      actorId: user.id,
      action: "attendance.report_exported",
      entityType: "attendance_report",
      after: { from: report.from, to: report.to, outlet: params.outlet ?? null, category: params.category ?? null, rows: report.rows.length, format },
    },
    await getAuditContext(),
  );

  const filename = `absensi-${report.from}-sd-${report.to}${format === "excel" ? "-excel" : ""}.csv`;
  return new Response(toCsv(rows, format), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
