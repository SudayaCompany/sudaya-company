import { UserRoundIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageSkeleton } from "@/components/page-header";
import { StaffShell } from "@/components/staff-shell";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db";
import { findSelfEmployee } from "@/lib/attendance/engine";
import { APPROVAL_STATUS_LABELS } from "@/lib/attendance/labels";
import { listOwnOutsideDuty } from "@/lib/attendance/queries";
import { requirePermission } from "@/lib/auth/session";
import { businessDateIn } from "@/lib/orders/dates";

import { CancelButton } from "./cancel-button";
import { OutsideDutyForm } from "./outside-duty-form";

export const metadata: Metadata = { title: "Tugas luar" };

export default function OutsideDutyPage() {
  return (
    <StaffShell title="Tugas luar" description="Ajukan tugas di luar outlet untuk disetujui Manager">
      <Suspense fallback={<PageSkeleton />}>
        <OutsideDuty />
      </Suspense>
    </StaffShell>
  );
}

async function OutsideDuty() {
  const user = await requirePermission("attendance.checkin");
  const employee = await findSelfEmployee(db, user);
  if (!employee) {
    return <EmptyState icon={UserRoundIcon} title="Akun belum terhubung ke data karyawan" description="Hubungi admin." />;
  }
  const requests = await listOwnOutsideDuty(db, employee.id);
  const time = new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: employee.timezone });

  return (
    <>
      <OutsideDutyForm today={businessDateIn(employee.timezone)} />
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Pengajuan saya</h2>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada pengajuan.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 px-3 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">
                    {r.dutyDate}
                    {r.startsAt && r.endsAt ? ` · ${time.format(r.startsAt)}–${time.format(r.endsAt)}` : ""}
                  </span>
                  <Badge variant={r.status === "approved" ? "secondary" : r.status === "rejected" ? "destructive" : "outline"}>
                    {APPROVAL_STATUS_LABELS[r.status]}
                  </Badge>
                </div>
                <span className="text-muted-foreground">{r.purpose} · {r.location}</span>
                {r.decisionNote ? <span className="text-xs text-muted-foreground">Catatan {r.decidedByName}: {r.decisionNote}</span> : null}
                {r.status === "pending" ? <CancelButton kind="outside_duty" id={r.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
