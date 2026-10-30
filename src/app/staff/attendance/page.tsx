import { BriefcaseIcon, ClockIcon, HistoryIcon, ScanFaceIcon, UserRoundIcon, WrenchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageSkeleton } from "@/components/page-header";
import { StaffShell } from "@/components/staff-shell";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db";
import { getStaffAttendanceState } from "@/lib/attendance/engine";
import { getFaceProvider } from "@/lib/attendance/face-provider";
import { formatMinutes } from "@/lib/attendance/labels";
import { requirePermission } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

import { AttendanceFlow } from "./attendance-flow";

export const metadata: Metadata = { title: "Absensi" };

export default function AttendancePage() {
  return (
    <StaffShell title="Absensi" description="Check-in & check-out dengan verifikasi wajah dan lokasi">
      <Suspense fallback={<PageSkeleton />}>
        <Attendance />
      </Suspense>
    </StaffShell>
  );
}

const LINKS = [
  { href: "/staff/attendance/history", label: "Riwayat", icon: HistoryIcon },
  { href: "/staff/attendance/correction", label: "Koreksi absensi", icon: WrenchIcon },
  { href: "/staff/outside-duty", label: "Tugas luar", icon: BriefcaseIcon },
  { href: "/staff/face-enrollment", label: "Registrasi wajah", icon: ScanFaceIcon },
];

async function Attendance() {
  const user = await requirePermission("attendance.checkin");
  const state = await getStaffAttendanceState(db, user, getFaceProvider());

  if (!state.employee) {
    return (
      <EmptyState
        icon={UserRoundIcon}
        title="Akun belum terhubung ke data karyawan"
        description="Minta admin menautkan akun Anda di menu Karyawan sebelum melakukan absensi."
      />
    );
  }
  const { employee, open, today, outsideDuty } = state;
  const time = new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: employee.timezone });
  const dateTime = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: employee.timezone });
  const hasCoordinates = employee.latitude !== null && employee.longitude !== null;
  const staleOpen = open && open.businessDate < state.businessToday;

  return (
    <>
      <section className={cn("flex flex-col gap-2 rounded-2xl p-5", open ? "bg-neutral-950 text-white" : "bg-muted")}>
        <p className={cn("text-sm", open ? "text-neutral-400" : "text-muted-foreground")}>
          {employee.fullName} · {employee.employeeCode} · {employee.outletName}
        </p>
        <p className="flex items-center gap-2 text-xl font-semibold">
          <ClockIcon className="size-5" />
          {open ? `Sedang bekerja sejak ${dateTime.format(open.checkInAt)}` : today.length ? "Sudah check-out" : "Belum check-in hari ini"}
        </p>
        {open && open.checkInMethod === "manual_correction" ? <Badge variant="outline">Masuk via koreksi manual</Badge> : null}
        {outsideDuty ? (
          <p className="text-sm">Tugas luar disetujui: {outsideDuty.location} — geofence outlet tidak berlaku.</p>
        ) : null}
      </section>

      {!employee.isActive ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">Status karyawan Anda nonaktif. Absensi tidak dapat dilakukan.</p>
      ) : null}
      {!state.providerState.ready ? (
        <div className="flex flex-col gap-1 rounded-xl border border-warning/60 bg-warning/10 p-3 text-sm">
          <p className="font-medium">{state.providerState.message}</p>
          <p className="text-muted-foreground">
            Absensi biometrik belum bisa dilakukan dan tidak akan ditandai terverifikasi. Kehadiran Anda tetap bisa dicatat lewat{" "}
            <Link href="/staff/attendance/correction" className="underline">koreksi absensi</Link> yang disetujui Manager.
          </p>
        </div>
      ) : null}
      {!hasCoordinates && !outsideDuty ? (
        <p className="rounded-xl border border-warning/60 bg-warning/10 p-3 text-sm">
          Koordinat outlet {employee.outletName} belum diatur. Hubungi Super Admin untuk konfigurasi lokasi outlet.
        </p>
      ) : null}
      {staleOpen ? (
        <p className="rounded-xl border border-warning/60 bg-warning/10 p-3 text-sm">
          Sesi tanggal {open.businessDate} belum check-out. Check-out sekarang atau{" "}
          <Link href="/staff/attendance/correction" className="underline">ajukan koreksi jam pulang</Link>.
        </p>
      ) : null}

      {employee.isActive ? (
        <AttendanceFlow
          mode={open ? "check_out" : "check_in"}
          providerReady={state.providerState.ready}
          providerMessage={state.providerState.ready ? null : state.providerState.message}
          enrolled={Boolean(state.enrollment)}
          outsideDuty={Boolean(outsideDuty)}
        />
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Hari ini ({state.businessToday})</h2>
        {today.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada absensi hari ini.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {today.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="tabular-nums">
                  {time.format(s.checkInAt)} – {s.checkOutAt ? time.format(s.checkOutAt) : "…"}
                </span>
                <span className="flex items-center gap-2">
                  {s.checkInMethod === "manual_correction" || s.checkOutMethod === "manual_correction" ? (
                    <Badge variant="outline">Koreksi manual</Badge>
                  ) : null}
                  <span className="tabular-nums text-muted-foreground">{formatMinutes(s.workingMinutes)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <nav className="grid grid-cols-2 gap-2" aria-label="Menu absensi">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="flex items-center gap-2 rounded-xl border p-3 text-sm font-medium hover:border-foreground">
            <l.icon className="size-4" /> {l.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
