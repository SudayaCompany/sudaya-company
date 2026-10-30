import { UserRoundIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageSkeleton } from "@/components/page-header";
import { StaffShell } from "@/components/staff-shell";
import { db } from "@/db";
import { getStaffAttendanceState } from "@/lib/attendance/engine";
import { getFaceProvider } from "@/lib/attendance/face-provider";
import { BIOMETRIC_NOTICE, BIOMETRIC_NOTICE_VERSION } from "@/lib/attendance/privacy";
import { requirePermission } from "@/lib/auth/session";

import { EnrollmentPanel } from "./enrollment-panel";

export const metadata: Metadata = { title: "Registrasi wajah" };

export default function FaceEnrollmentPage() {
  return (
    <StaffShell title="Registrasi wajah" description="Pemberitahuan privasi, persetujuan, dan status data wajah Anda">
      <Suspense fallback={<PageSkeleton />}>
        <Enrollment />
      </Suspense>
    </StaffShell>
  );
}

async function Enrollment() {
  const user = await requirePermission("attendance.checkin");
  const state = await getStaffAttendanceState(db, user, getFaceProvider());
  if (!state.employee) {
    return <EmptyState icon={UserRoundIcon} title="Akun belum terhubung ke data karyawan" description="Hubungi admin." />;
  }
  const date = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: state.employee.timezone });

  return (
    <>
      <section className="flex flex-col gap-3 rounded-2xl border p-4" aria-labelledby="privacy-title">
        <h2 id="privacy-title" className="font-semibold">Pemberitahuan privasi data biometrik</h2>
        <p className="text-xs text-muted-foreground">Versi {BIOMETRIC_NOTICE_VERSION} · UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi</p>
        {BIOMETRIC_NOTICE.map((section) => (
          <div key={section.title} className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">{section.title}</h3>
            <p className="text-sm text-muted-foreground">{section.body}</p>
          </div>
        ))}
      </section>

      <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 rounded-2xl border p-4 text-sm">
        <dt className="text-muted-foreground">Status</dt>
        <dd>{state.enrollment ? `Terdaftar sejak ${date.format(state.enrollment.createdAt)}` : "Belum terdaftar"}</dd>
        <dt className="text-muted-foreground">Persetujuan</dt>
        <dd>{state.consent ? `Diberikan ${date.format(state.consent.givenAt)}` : "Belum diberikan"}</dd>
        <dt className="text-muted-foreground">Layanan</dt>
        <dd>{state.providerState.ready ? "Tersedia" : "Belum dikonfigurasi"}</dd>
      </dl>

      <EnrollmentPanel
        noticeVersion={BIOMETRIC_NOTICE_VERSION}
        providerReady={state.providerState.ready}
        providerMessage={state.providerState.ready ? null : state.providerState.message}
        consented={Boolean(state.consent)}
        enrolled={Boolean(state.enrollment)}
      />
    </>
  );
}
