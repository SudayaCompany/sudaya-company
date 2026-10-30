import { BriefcaseIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DecisionButtons } from "@/components/attendance/decision-buttons";
import { EmptyState } from "@/components/empty-state";
import { PageHeader, PageSkeleton } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db";
import { APPROVAL_STATUS_LABELS } from "@/lib/attendance/labels";
import { listOutsideDutyRequests } from "@/lib/attendance/queries";
import { requireAnyPermission } from "@/lib/auth/session";
import { firstValues, toQuery } from "@/lib/search-params";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tugas luar" };

const STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;

export default function OutsideDutyAdminPage({ searchParams }: PageProps<"/admin/outside-duty">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OutsideDuty searchParams={searchParams} />
    </Suspense>
  );
}

async function OutsideDuty({ searchParams }: Pick<PageProps<"/admin/outside-duty">, "searchParams">) {
  const actor = await requireAnyPermission(["attendance.approve_outside_duty", "attendance.view"]);
  const raw = firstValues(await searchParams);
  const status = STATUSES.find((s) => s === raw.status) ?? (raw.status === "all" ? undefined : "pending");
  const list = await listOutsideDutyRequests(db, actor, { status, outlet: raw.outlet });

  return (
    <>
      <PageHeader title="Tugas luar" description="Pengajuan karyawan; pemohon tidak bisa menyetujui sendiri" />
      <nav className="flex flex-wrap gap-1.5" aria-label="Filter status">
        {[...STATUSES, "all" as const].map((s) => {
          const active = (s === "all" && !status) || s === status;
          return (
            <Link
              key={s}
              href={`/admin/outside-duty${toQuery({ status: s, outlet: raw.outlet })}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium",
                active ? "border-neutral-950 bg-neutral-950 text-white" : "bg-background hover:border-foreground",
              )}
            >
              {s === "all" ? "Semua" : APPROVAL_STATUS_LABELS[s]}
            </Link>
          );
        })}
      </nav>

      {list.rows.length === 0 ? (
        <EmptyState icon={BriefcaseIcon} title="Tidak ada pengajuan" description="Pengajuan tugas luar karyawan tampil di sini." />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.rows.map((r) => {
            const time = new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: r.timezone });
            const slot = r.startsAt && r.endsAt ? `${time.format(r.startsAt)}–${time.format(r.endsAt)}` : "";
            return (
              <li key={r.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {r.employeeName}
                    <span className="font-mono text-xs text-muted-foreground">{r.employeeCode}</span>
                    <Badge variant={r.status === "approved" ? "secondary" : r.status === "rejected" ? "destructive" : "outline"}>
                      {APPROVAL_STATUS_LABELS[r.status]}
                    </Badge>
                  </p>
                  <p>{r.dutyDate} · {slot} · {r.location}</p>
                  <p className="text-muted-foreground">Tujuan: {r.purpose}</p>
                  {r.notes ? <p className="text-muted-foreground">Alasan: {r.notes}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {r.outletName}
                    {r.hasEvidence ? " · ada bukti pendukung" : ""}
                    {r.decidedByName ? ` · diputuskan ${r.decidedByName}` : ""}
                    {r.decisionNote ? ` — ${r.decisionNote}` : ""}
                  </p>
                </div>
                <DecisionButtons
                  kind="outside_duty"
                  approvalId={r.approvalId}
                  canApprove={r.canDecide}
                  canReject={r.canDecide}
                  summary={`${r.employeeName}: ${r.purpose} di ${r.location}, ${r.dutyDate} ${slot}. Setelah disetujui, geofence outlet tidak berlaku pada jam tersebut.`}
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
