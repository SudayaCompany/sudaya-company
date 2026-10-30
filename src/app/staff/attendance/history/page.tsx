import { HistoryIcon, UserRoundIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageSkeleton } from "@/components/page-header";
import { StaffShell } from "@/components/staff-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/db";
import { APPROVAL_STATUS_LABELS, CORRECTION_KIND_LABELS, formatMinutes } from "@/lib/attendance/labels";
import { CATEGORY_LABELS, getOwnHistory, methodLabel } from "@/lib/attendance/queries";
import { requirePermission } from "@/lib/auth/session";
import { firstValues } from "@/lib/search-params";

export const metadata: Metadata = { title: "Riwayat absensi" };

export default function HistoryPage({ searchParams }: PageProps<"/staff/attendance/history">) {
  return (
    <StaffShell title="Riwayat absensi" description="Hanya data absensi milik Anda" back="/staff/attendance">
      <Suspense fallback={<PageSkeleton />}>
        <History searchParams={searchParams} />
      </Suspense>
    </StaffShell>
  );
}

async function History({ searchParams }: Pick<PageProps<"/staff/attendance/history">, "searchParams">) {
  const user = await requirePermission("attendance.checkin");
  const raw = firstValues(await searchParams);
  const history = await getOwnHistory(db, user, raw.month);
  if (!history) {
    return <EmptyState icon={UserRoundIcon} title="Akun belum terhubung ke data karyawan" description="Hubungi admin." />;
  }
  const tz = history.employee.timezone;
  const day = new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: tz });
  const time = new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: tz });

  return (
    <>
      <form method="get" className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Bulan
          <Input type="month" name="month" defaultValue={history.month} className="h-11" />
        </label>
        <Button type="submit" variant="outline" className="h-11">Tampilkan</Button>
      </form>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border p-3">
          <p className="text-xs text-muted-foreground">Sesi</p>
          <p className="text-2xl font-semibold tabular-nums">{history.sessions.length}</p>
        </div>
        <div className="rounded-xl border p-3">
          <p className="text-xs text-muted-foreground">Total jam (aktual)</p>
          <p className="text-2xl font-semibold tabular-nums">{formatMinutes(history.totalMinutes)}</p>
        </div>
      </section>

      {history.sessions.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="Belum ada absensi" description="Absensi bulan ini akan tampil di sini." />
      ) : (
        <ul className="flex flex-col gap-2">
          {history.sessions.map((s) => (
            <li key={s.id} className="flex flex-col gap-1 rounded-xl border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{day.format(new Date(`${s.businessDate}T12:00:00Z`))}</p>
                <Badge variant={s.category === "verified" ? "secondary" : "outline"}>{CATEGORY_LABELS[s.category]}</Badge>
              </div>
              <p className="text-sm tabular-nums">
                {time.format(s.checkInAt)} – {s.checkOutAt ? time.format(s.checkOutAt) : "belum check-out"} ·{" "}
                {formatMinutes(s.workingMinutes)}
              </p>
              <p className="text-xs text-muted-foreground">
                {s.outletName} · {methodLabel(s.checkInMethod, s.checkOutMethod)}
                {s.outsideDutyLocation ? ` · Tugas luar: ${s.outsideDutyLocation}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Koreksi absensi</h2>
          <Link href="/staff/attendance/correction" className="text-sm underline">Ajukan</Link>
        </div>
        {history.corrections.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada pengajuan koreksi.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {history.corrections.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span>
                  {CORRECTION_KIND_LABELS[c.kind]} · {c.businessDate}
                  <span className="block text-xs text-muted-foreground">{c.reason}</span>
                </span>
                <Badge variant="outline">{APPROVAL_STATUS_LABELS[c.status]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Tugas luar</h2>
          <Link href="/staff/outside-duty" className="text-sm underline">Ajukan</Link>
        </div>
        {history.duties.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada pengajuan tugas luar.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {history.duties.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span>
                  {d.dutyDate} · {d.location}
                  <span className="block text-xs text-muted-foreground">{d.purpose}</span>
                </span>
                <Badge variant="outline">{APPROVAL_STATUS_LABELS[d.status]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
