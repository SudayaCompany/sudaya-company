import { ClockIcon, FileDownIcon, SearchIcon, Settings2Icon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DecisionButtons } from "@/components/attendance/decision-buttons";
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
import { CORRECTION_KIND_LABELS, DASHBOARD_STATUS_LABELS, formatMinutes } from "@/lib/attendance/labels";
import { attendanceDashboard, listPendingCorrections } from "@/lib/attendance/queries";
import { attendanceListParams } from "@/lib/attendance/schemas";
import { hasPermission } from "@/lib/auth/policy";
import { requirePermission } from "@/lib/auth/session";
import { firstValues } from "@/lib/search-params";

export const metadata: Metadata = { title: "Absensi" };

export default function AttendanceAdminPage({ searchParams }: PageProps<"/admin/attendance">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

const STATUS_STYLES = {
  working: "border-transparent bg-success/15 text-success",
  checked_out: "border-transparent bg-secondary text-secondary-foreground",
  not_checked_in: "text-muted-foreground",
} as const;

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

async function Dashboard({ searchParams }: Pick<PageProps<"/admin/attendance">, "searchParams">) {
  const actor = await requirePermission("attendance.view");
  const params = attendanceListParams.parse(firstValues(await searchParams));
  const [board, corrections] = await Promise.all([
    attendanceDashboard(db, actor, params),
    listPendingCorrections(db, actor, params.outlet),
  ]);
  const s = board.summary;
  const time = (date: Date | null, tz: string) =>
    date ? new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: tz }).format(date) : "—";

  return (
    <>
      <PageHeader title="Absensi" description={`${board.date} · jam kerja aktual dari check-in/check-out`}>
        <div className="flex flex-wrap gap-2">
          {hasPermission(actor, "report.attendance") ? (
            <Link href="/admin/attendance/reports" className={buttonVariants({ variant: "outline" })}>
              <FileDownIcon /> Laporan
            </Link>
          ) : null}
          {hasPermission(actor, "settings.manage", { outletId: null }) ? (
            <Link href="/admin/attendance/settings" className={buttonVariants({ variant: "outline" })}>
              <Settings2Icon /> Pengaturan
            </Link>
          ) : null}
        </div>
      </PageHeader>

      <form method="get" className="grid grid-cols-2 gap-2 lg:grid-cols-[auto_1fr_auto_auto_auto]">
        <Input type="date" name="date" defaultValue={board.date} aria-label="Tanggal" className="col-span-2 lg:col-span-1" />
        <div className="relative col-span-2 lg:col-span-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" type="search" defaultValue={params.q} placeholder="Cari nama / Employee ID" className="pl-8" aria-label="Cari karyawan" />
        </div>
        <NativeSelect name="outlet" defaultValue={params.outlet ?? ""} aria-label="Outlet" className="w-full">
          <NativeSelectOption value="">Semua outlet</NativeSelectOption>
          {board.outlets.map((o) => (
            <NativeSelectOption key={o.id} value={o.id}>{o.name}</NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="status" defaultValue={params.status ?? ""} aria-label="Status" className="w-full">
          <NativeSelectOption value="">Semua status</NativeSelectOption>
          <NativeSelectOption value="checked_in">Sudah check-in</NativeSelectOption>
          <NativeSelectOption value="working">Sedang bekerja</NativeSelectOption>
          <NativeSelectOption value="checked_out">Sudah check-out</NativeSelectOption>
          <NativeSelectOption value="not_checked_in">Belum check-in</NativeSelectOption>
          <NativeSelectOption value="outside_duty">Tugas luar</NativeSelectOption>
        </NativeSelect>
        <Button type="submit" variant="outline" className="col-span-2 lg:col-span-1">Terapkan</Button>
      </form>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Ringkasan absensi">
        <Stat label="Karyawan aktif" value={s.employees} />
        <Stat label="Sudah check-in" value={s.checkedIn} />
        <Stat label="Belum check-in" value={s.notCheckedIn} hint="Bukan berarti terlambat/absen" />
        <Stat label="Sedang bekerja" value={s.working} />
        <Stat label="Sudah check-out" value={s.checkedOut} />
        <Stat label="Tugas luar" value={s.outsideDuty} hint="Disetujui untuk tanggal ini" />
      </section>
      <p className="text-xs text-muted-foreground">
        Belum ada jadwal shift resmi, jadi status &quot;belum check-in&quot; tidak dihitung sebagai keterlambatan atau ketidakhadiran.
      </p>

      {corrections.length ? (
        <Card>
          <CardHeader><CardTitle>Koreksi menunggu persetujuan ({corrections.length})</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {corrections.map((c) => {
                const dt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: c.timezone });
                const summary = `${c.employeeName}: ${CORRECTION_KIND_LABELS[c.kind]} ${c.requestedCheckInAt ? `${dt.format(c.requestedCheckInAt)} – ` : "pulang "}${dt.format(c.requestedCheckOutAt)}. Disimpan sebagai koreksi manual, bukan absensi biometrik.`;
                return (
                  <li key={c.id} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">{c.employeeName} · {CORRECTION_KIND_LABELS[c.kind]}</p>
                      <p className="text-muted-foreground">
                        {c.requestedCheckInAt ? `${dt.format(c.requestedCheckInAt)} – ` : "Pulang "}
                        {dt.format(c.requestedCheckOutAt)}
                      </p>
                      <p className="text-xs text-muted-foreground">{c.reason}</p>
                    </div>
                    <DecisionButtons kind="correction" approvalId={c.approvalId} canApprove={c.canApprove} canReject={c.canReject} summary={summary} />
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {board.rows.length === 0 ? (
        <EmptyState icon={ClockIcon} title="Tidak ada data" description="Belum ada karyawan aktif yang cocok dengan filter." />
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {board.rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-1.5 rounded-xl border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.fullName}</p>
                    <p className="text-xs text-muted-foreground">{r.employeeCode} · {r.outletName}</p>
                  </div>
                  <Badge variant="outline" className={STATUS_STYLES[r.status]}>{DASHBOARD_STATUS_LABELS[r.status]}</Badge>
                </div>
                <p className="text-sm tabular-nums">
                  Masuk {time(r.firstCheckIn, r.timezone)} · Pulang {time(r.lastCheckOut, r.timezone)} · {r.sessions ? formatMinutes(r.workedMinutes) : "—"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {r.manual ? <Badge variant="outline">Koreksi manual</Badge> : null}
                  {r.outsideDuty ? <Badge variant="outline">Tugas luar: {r.outsideDuty.location}</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
          <Card className="hidden md:block">
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Karyawan</TableHead>
                    <TableHead>Outlet</TableHead>
                    <TableHead>Masuk</TableHead>
                    <TableHead>Pulang</TableHead>
                    <TableHead className="text-right">Jam kerja</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Keterangan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {board.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <p className="font-medium">{r.fullName}</p>
                        <p className="font-mono text-xs text-muted-foreground">{r.employeeCode}</p>
                      </TableCell>
                      <TableCell className="text-sm">{r.outletName}</TableCell>
                      <TableCell className="tabular-nums">{time(r.firstCheckIn, r.timezone)}</TableCell>
                      <TableCell className="tabular-nums">{time(r.lastCheckOut, r.timezone)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.sessions ? formatMinutes(r.workedMinutes) : "—"}</TableCell>
                      <TableCell><Badge variant="outline" className={STATUS_STYLES[r.status]}>{DASHBOARD_STATUS_LABELS[r.status]}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {[r.manual ? "Koreksi manual" : null, r.outsideDuty ? `Tugas luar: ${r.outsideDuty.location}` : null, r.sessions > 1 ? `${r.sessions} sesi` : null]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
