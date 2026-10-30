import { FileDownIcon, FileSpreadsheetIcon, SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader, PageSkeleton } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import { formatMinutes } from "@/lib/attendance/labels";
import { attendanceReport, CATEGORY_LABELS, type ReportCategory } from "@/lib/attendance/queries";
import { attendanceListParams } from "@/lib/attendance/schemas";
import { requirePermission } from "@/lib/auth/session";
import { firstValues, toQuery } from "@/lib/search-params";

export const metadata: Metadata = { title: "Laporan absensi" };

export default function ReportsPage({ searchParams }: PageProps<"/admin/attendance/reports">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Reports searchParams={searchParams} />
    </Suspense>
  );
}

const CATEGORIES: ReportCategory[] = ["verified", "manual", "outside_duty", "incomplete"];

async function Reports({ searchParams }: Pick<PageProps<"/admin/attendance/reports">, "searchParams">) {
  const actor = await requirePermission("report.attendance");
  const params = attendanceListParams.parse(firstValues(await searchParams));
  const report = await attendanceReport(db, actor, params);
  const query = (format: string) =>
    toQuery({ from: report.from, to: report.to, outlet: params.outlet, q: params.q, category: params.category, format });
  const fmt = (date: Date | null, tz: string) =>
    date ? new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: tz }).format(date) : "—";

  return (
    <>
      <PageHeader title="Laporan absensi" description={`${report.from} s/d ${report.to} · data sungguhan dari check-in/check-out`}>
        <div className="flex flex-wrap gap-2">
          <a href={`/admin/attendance/reports/export${query("csv")}`} className={buttonVariants({ variant: "outline" })}>
            <FileDownIcon /> CSV
          </a>
          <a href={`/admin/attendance/reports/export${query("excel")}`} className={buttonVariants({ variant: "outline" })}>
            <FileSpreadsheetIcon /> Excel
          </a>
        </div>
      </PageHeader>

      <form method="get" className="grid grid-cols-2 gap-2 lg:grid-cols-[auto_auto_1fr_auto_auto_auto]">
        <Input type="date" name="from" defaultValue={report.from} aria-label="Dari tanggal" />
        <Input type="date" name="to" defaultValue={report.to} aria-label="Sampai tanggal" />
        <div className="relative col-span-2 lg:col-span-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" type="search" defaultValue={params.q} placeholder="Cari nama / Employee ID" className="pl-8" aria-label="Cari karyawan" />
        </div>
        <NativeSelect name="outlet" defaultValue={params.outlet ?? ""} aria-label="Outlet" className="w-full">
          <NativeSelectOption value="">Semua outlet</NativeSelectOption>
          {report.outlets.map((o) => (
            <NativeSelectOption key={o.id} value={o.id}>{o.name}</NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="category" defaultValue={params.category ?? ""} aria-label="Kategori" className="w-full">
          <NativeSelectOption value="">Semua kategori</NativeSelectOption>
          {CATEGORIES.map((c) => (
            <NativeSelectOption key={c} value={c}>{CATEGORY_LABELS[c]}</NativeSelectOption>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline" className="col-span-2 lg:col-span-1">Terapkan</Button>
      </form>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Ringkasan laporan">
        {CATEGORIES.map((c) => (
          <div key={c} className="flex flex-col gap-1 rounded-xl border p-4">
            <p className="text-xs font-medium text-muted-foreground">{CATEGORY_LABELS[c]}</p>
            <p className="text-2xl font-semibold tabular-nums">{report.counts[c]}</p>
          </div>
        ))}
        <div className="col-span-2 flex flex-col gap-1 rounded-xl border p-4 lg:col-span-1">
          <p className="text-xs font-medium text-muted-foreground">Total jam (sesi lengkap)</p>
          <p className="text-2xl font-semibold tabular-nums">{formatMinutes(report.totalMinutes)}</p>
        </div>
      </section>

      {report.rows.length === 0 ? (
        <EmptyState icon={FileDownIcon} title="Tidak ada data" description="Tidak ada absensi pada rentang & filter ini." />
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {report.rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 rounded-xl border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{r.employeeName}</p>
                  <Badge variant={r.category === "verified" ? "secondary" : "outline"}>{CATEGORY_LABELS[r.category]}</Badge>
                </div>
                <p className="tabular-nums">{r.businessDate} · {fmt(r.checkInAt, r.timezone)} – {fmt(r.checkOutAt, r.timezone)} · {formatMinutes(r.workingMinutes)}</p>
                <p className="text-xs text-muted-foreground">{r.outletName} · {r.method}{r.notes ? ` · ${r.notes}` : ""}</p>
              </li>
            ))}
          </ul>
          <Card className="hidden md:block">
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Outlet</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Check-In</TableHead>
                    <TableHead>Check-Out</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Metode</TableHead>
                    <TableHead>Catatan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <p className="font-medium">{r.employeeName}</p>
                        <p className="font-mono text-xs text-muted-foreground">{r.employeeCode}</p>
                      </TableCell>
                      <TableCell className="text-sm">{r.outletName}</TableCell>
                      <TableCell className="tabular-nums">{r.businessDate}</TableCell>
                      <TableCell className="tabular-nums">{fmt(r.checkInAt, r.timezone)}</TableCell>
                      <TableCell className="tabular-nums">{fmt(r.checkOutAt, r.timezone)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMinutes(r.workingMinutes)}</TableCell>
                      <TableCell><Badge variant={r.category === "verified" ? "secondary" : "outline"}>{CATEGORY_LABELS[r.category]}</Badge></TableCell>
                      <TableCell className="text-xs whitespace-normal">{r.method}</TableCell>
                      <TableCell className="min-w-48 text-xs whitespace-normal text-muted-foreground">{r.notes || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader><CardTitle>Tugas luar disetujui ({report.approvedDuties.length})</CardTitle></CardHeader>
        <CardContent>
          {report.approvedDuties.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tidak ada tugas luar disetujui pada rentang ini.</p>
          ) : (
            <ul className="flex flex-col divide-y text-sm">
              {report.approvedDuties.map((d) => (
                <li key={d.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between">
                  <span>{d.dutyDate} · {d.employeeName} · {d.location}</span>
                  <span className="text-xs text-muted-foreground">
                    {fmt(d.startsAt, d.timezone)}–{fmt(d.endsAt, d.timezone)} · {d.purpose}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
