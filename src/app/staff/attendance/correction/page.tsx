import { UserRoundIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageSkeleton } from "@/components/page-header";
import { StaffShell } from "@/components/staff-shell";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db";
import { findSelfEmployee } from "@/lib/attendance/engine";
import { APPROVAL_STATUS_LABELS, CORRECTION_KIND_LABELS } from "@/lib/attendance/labels";
import { getOwnHistory, listOwnOpenSessions } from "@/lib/attendance/queries";
import { requirePermission } from "@/lib/auth/session";

import { CancelButton } from "../../outside-duty/cancel-button";

import { CorrectionForm } from "./correction-form";

export const metadata: Metadata = { title: "Koreksi absensi" };

export default function CorrectionPage() {
  return (
    <StaffShell
      title="Koreksi absensi"
      description="Untuk layanan verifikasi gagal/belum tersedia, GPS tidak akurat, atau lupa check-out"
      back="/staff/attendance"
    >
      <Suspense fallback={<PageSkeleton />}>
        <Correction />
      </Suspense>
    </StaffShell>
  );
}

async function Correction() {
  const user = await requirePermission("attendance.checkin");
  const employee = await findSelfEmployee(db, user);
  if (!employee) {
    return <EmptyState icon={UserRoundIcon} title="Akun belum terhubung ke data karyawan" description="Hubungi admin." />;
  }
  const [open, history] = await Promise.all([listOwnOpenSessions(db, employee.id), getOwnHistory(db, user, undefined)]);
  const dateTime = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: employee.timezone });
  // Batas input = sekarang (waktu lokal outlet); server tetap memvalidasi dengan waktu DB.
  const maxLocal = new Date().toLocaleString("sv-SE", { timeZone: employee.timezone }).slice(0, 16).replace(" ", "T");

  return (
    <>
      <CorrectionForm
        openSessions={open.map((s) => ({ id: s.id, label: `Masuk ${dateTime.format(s.checkInAt)}` }))}
        maxLocal={maxLocal}
      />
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Pengajuan saya</h2>
        {history!.corrections.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada pengajuan koreksi.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {history!.corrections.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 px-3 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{CORRECTION_KIND_LABELS[c.kind]} · {c.businessDate}</span>
                  <Badge variant="outline">{APPROVAL_STATUS_LABELS[c.status]}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {c.requestedCheckInAt ? `${dateTime.format(c.requestedCheckInAt)} – ` : "Pulang "}
                  {dateTime.format(c.requestedCheckOutAt)} · {c.reason}
                </span>
                {c.decisionNote ? <span className="text-xs text-muted-foreground">Catatan: {c.decisionNote}</span> : null}
                {c.status === "pending" ? <CancelButton kind="correction" id={c.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
