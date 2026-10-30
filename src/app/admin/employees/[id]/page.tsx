import { ArrowLeftIcon, PencilIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { getEmployee } from "@/lib/attendance/employees";
import { formatMinutes } from "@/lib/attendance/labels";
import { categoryOf, CATEGORY_LABELS, methodLabel } from "@/lib/attendance/queries";
import { AccessError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/session";

import { RevokeFaceButton } from "./revoke-face";

export const metadata: Metadata = { title: "Detail karyawan" };

export default function EmployeeDetailPage({ params }: PageProps<"/admin/employees/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EmployeeDetail params={params} />
    </Suspense>
  );
}

async function EmployeeDetail({ params }: Pick<PageProps<"/admin/employees/[id]">, "params">) {
  const actor = await requirePermission("employee.view");
  const { id } = await params;
  const detail = await getEmployee(db, actor, id).catch((error: unknown) => {
    if (error instanceof AccessError) notFound();
    throw error;
  });
  const e = detail.employee;
  const dt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: e.timezone });
  const time = new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: e.timezone });

  return (
    <>
      <Link href="/admin/employees" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Semua karyawan
      </Link>
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {e.fullName}
            {e.isActive ? <Badge variant="secondary" className="bg-success/15 text-success">Aktif</Badge> : <Badge variant="outline">Nonaktif</Badge>}
          </h1>
          <p className="font-mono text-sm text-muted-foreground">{e.employeeCode}</p>
        </div>
        {detail.canEdit ? (
          <Link href={`/admin/employees/${e.id}/edit`} className={buttonVariants({ variant: "outline" })}>
            <PencilIcon /> Ubah
          </Link>
        ) : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Profil</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Jabatan</dt><dd>{e.position ?? "—"}</dd>
              <dt className="text-muted-foreground">Outlet</dt><dd>{e.outletName}</dd>
              <dt className="text-muted-foreground">Telepon</dt><dd>{e.phone ?? "—"}</dd>
              <dt className="text-muted-foreground">Bergabung</dt><dd>{e.joinedAt ?? "—"}</dd>
              <dt className="text-muted-foreground">Email akun</dt><dd className="break-all">{e.email ?? "Belum punya akun"}</dd>
              <dt className="text-muted-foreground">Status akun</dt>
              <dd>{e.userId ? (e.accountActive ? "Aktif" : "Nonaktif") : "—"}</dd>
              <dt className="text-muted-foreground">Role</dt>
              <dd>{detail.roles.length ? detail.roles.join(", ") : "—"} <Link href="/admin/users" className="text-xs underline">kelola</Link></dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Data wajah & persetujuan</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {detail.activeEnrollment ? (
              <p>Terdaftar sejak {dt.format(detail.activeEnrollment.createdAt)} ({detail.activeEnrollment.provider})</p>
            ) : (
              <p className="text-muted-foreground">Belum terdaftar.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Foto & template wajah tidak disimpan di Sudaya Company dan tidak dapat diunduh; hanya referensi di layanan verifikasi.
            </p>
            {detail.activeEnrollment && detail.canEdit ? <RevokeFaceButton employeeId={e.id} name={e.fullName} /> : null}
            {detail.enrollments.some((x) => x.revokedAt) ? (
              <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                {detail.enrollments.filter((x) => x.revokedAt).map((x) => (
                  <li key={x.id}>
                    Dicabut {dt.format(x.revokedAt!)} — {x.revokedReason}
                    {x.providerDeletedAt ? " · dihapus di provider" : " · penghapusan di provider tertunda"}
                  </li>
                ))}
              </ul>
            ) : null}
            <div>
              <p className="mb-1 font-medium">Riwayat persetujuan</p>
              {detail.consents.length === 0 ? (
                <p className="text-muted-foreground">Belum ada.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-xs">
                  {detail.consents.map((c) => (
                    <li key={c.id}>
                      Versi {c.noticeVersion} ({c.basis}) · diberikan {dt.format(c.givenAt)}
                      {c.withdrawnAt ? ` · ditarik ${dt.format(c.withdrawnAt)}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Absensi terbaru</CardTitle></CardHeader>
        <CardContent>
          {detail.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada absensi.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {detail.recent.map((s) => (
                <li key={s.id} className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="tabular-nums">
                    {s.businessDate} · {time.format(s.checkInAt)} – {s.checkOutAt ? time.format(s.checkOutAt) : "…"} · {formatMinutes(s.workingMinutes)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {CATEGORY_LABELS[categoryOf(s)]} · {methodLabel(s.checkInMethod, s.checkOutMethod)}
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
