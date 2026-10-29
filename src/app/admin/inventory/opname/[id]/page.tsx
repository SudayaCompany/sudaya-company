import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ApprovalButtons } from "@/components/inventory/approval-buttons";
import { PageSkeleton } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import { AccessError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/session";
import { formatRupiah } from "@/lib/format";
import { getOpname } from "@/lib/inventory/queries";
import { formatQty, formatSignedQty, qtyFromDb } from "@/lib/inventory/units";
import { cn } from "@/lib/utils";

import { OpnameStatusBadge } from "../opname-status";

import { CountSheet } from "./count-sheet";

export const metadata: Metadata = { title: "Detail opname" };

export default function OpnameDetailPage({ params }: PageProps<"/admin/inventory/opname/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OpnameDetail params={params} />
    </Suspense>
  );
}

async function OpnameDetail({ params }: Pick<PageProps<"/admin/inventory/opname/[id]">, "params">) {
  const actor = await requirePermission("inventory.view");
  const { id } = await params;
  const detail = await getOpname(db, actor, id).catch((error: unknown) => {
    if (error instanceof AccessError) notFound();
    throw error;
  });
  const { opname, outlet, items } = detail;
  const time = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: outlet.timezone });
  const counted = items.filter((i) => i.actualQty !== null);
  const withVariance = counted.filter((i) => qtyFromDb(i.variance) !== 0n);
  const costed = withVariance.filter((i) => i.varianceValue !== null);
  const varianceValue = costed.reduce((sum, i) => sum + (i.varianceValue ?? 0), 0);

  return (
    <>
      <Link
        href={`/admin/inventory/opname?outlet=${outlet.id}`}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" /> Semua opname
      </Link>
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            Opname {time.format(opname.snapshotAt)} <OpnameStatusBadge status={opname.status} />
          </h1>
          <p className="text-sm text-muted-foreground">
            {outlet.name} · dibuat {opname.createdByName ?? "—"}
            {opname.notes ? ` · ${opname.notes}` : ""}
          </p>
        </div>
        {detail.canApprove || detail.canReject ? (
          <ApprovalButtons
            approvalId={opname.approvalId!}
            canApprove={detail.canApprove}
            canReject={detail.canReject}
            summary={`${withVariance.length} item selisih akan diposting sebagai movement opname.`}
          />
        ) : null}
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Ringkasan opname">
        <div className="rounded-xl border p-3">
          <p className="text-xs text-muted-foreground">Dihitung</p>
          <p className="text-xl font-semibold tabular-nums">{counted.length}/{items.length}</p>
        </div>
        <div className="rounded-xl border p-3">
          <p className="text-xs text-muted-foreground">Item selisih</p>
          <p className="text-xl font-semibold tabular-nums">{withVariance.length}</p>
        </div>
        <div className="rounded-xl border p-3">
          <p className="text-xs text-muted-foreground">Nilai selisih</p>
          <p className="text-xl font-semibold tabular-nums">{costed.length ? formatRupiah(varianceValue) : "—"}</p>
          {withVariance.length > costed.length ? (
            <p className="text-xs text-muted-foreground">{withVariance.length - costed.length} item tanpa harga pokok</p>
          ) : null}
        </div>
        <div className="rounded-xl border p-3">
          <p className="text-xs text-muted-foreground">Status</p>
          <p className="text-sm font-medium">
            {opname.status === "submitted"
              ? `Diajukan ${opname.requestedByName ?? ""}`
              : opname.status === "applied"
                ? `Diposting ${opname.postedAt ? time.format(opname.postedAt) : ""}`
                : opname.status === "rejected"
                  ? `Ditolak ${opname.decidedByName ?? ""}`
                  : opname.status === "cancelled"
                    ? "Dibatalkan"
                    : "Sedang dihitung"}
          </p>
          {opname.decisionNote ? <p className="text-xs text-muted-foreground">{opname.decisionNote}</p> : null}
        </div>
      </section>

      {opname.status === "submitted" && !detail.canApprove ? (
        <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
          Menunggu persetujuan Manager (pengaju tidak bisa menyetujui sendiri). Stok belum berubah.
        </p>
      ) : null}

      {detail.canCount ? (
        <CountSheet opnameId={opname.id} rows={items} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Hasil hitung</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 md:hidden">
              {items.map((i) => (
                <li key={i.itemId} className="flex items-start justify-between gap-3 rounded-xl border p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{i.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Sistem {formatQty(i.systemQty, i.unit)} · Fisik {i.actualQty === null ? "—" : formatQty(i.actualQty, i.unit)}
                    </p>
                    {i.reason ? <p className="text-xs text-muted-foreground">{i.reason}</p> : null}
                  </div>
                  <Variance value={i.variance} unit={i.unit} />
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Sistem (snapshot)</TableHead>
                    <TableHead className="text-right">Fisik</TableHead>
                    <TableHead className="text-right">Selisih</TableHead>
                    <TableHead className="text-right">Nilai</TableHead>
                    <TableHead>Alasan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((i) => (
                    <TableRow key={i.itemId}>
                      <TableCell>
                        <p className="font-medium">{i.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{i.sku}</p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(i.systemQty, i.unit)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {i.actualQty === null ? <span className="text-muted-foreground">—</span> : formatQty(i.actualQty, i.unit)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Variance value={i.variance} unit={i.unit} />
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {i.varianceValue === null || qtyFromDb(i.variance) === 0n ? "—" : formatRupiah(i.varianceValue)}
                      </TableCell>
                      <TableCell className="max-w-64 text-sm text-muted-foreground">{i.reason ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function Variance({ value, unit }: { value: string | null; unit: string }) {
  if (value === null) return <span className="text-sm text-muted-foreground">Tidak dihitung</span>;
  const v = qtyFromDb(value);
  return (
    <span className={cn("font-medium tabular-nums", v === 0n ? "text-success" : v < 0n ? "text-destructive" : "")}>
      {v === 0n ? "Sesuai" : formatSignedQty(v, unit)}
    </span>
  );
}
