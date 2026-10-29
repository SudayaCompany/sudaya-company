import type { Metadata } from "next";
import { Suspense } from "react";

import { OutletSelect } from "@/components/inventory/outlet-select";
import { PageHeader, PageSkeleton } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/db";
import { hasPermission } from "@/lib/auth/policy";
import { requirePermission } from "@/lib/auth/session";
import { formatRupiah } from "@/lib/format";
import { listItemOptions, listMovements, wasteParams, wasteSummary } from "@/lib/inventory/queries";
import { formatQty } from "@/lib/inventory/units";
import { firstValues } from "@/lib/search-params";

import { IssueForm } from "../issue-form";
import { MovementList } from "../movement-list";
import { resolveInventoryOutlet } from "../scope";

export const metadata: Metadata = { title: "Waste" };

export default function WastePage({ searchParams }: PageProps<"/admin/inventory/waste">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Waste searchParams={searchParams} />
    </Suspense>
  );
}

const valueText = (value: number | null, uncosted: number) =>
  value === null
    ? "Nilai belum diketahui"
    : `${formatRupiah(value)}${uncosted ? ` (+${uncosted} catatan tanpa harga pokok)` : ""}`;

async function Waste({ searchParams }: Pick<PageProps<"/admin/inventory/waste">, "searchParams">) {
  const actor = await requirePermission("inventory.view");
  const raw = firstValues(await searchParams);
  const { outlets, outlet } = await resolveInventoryOutlet(actor, "inventory.view", raw.outlet);
  const canRecord = hasPermission(actor, "inventory.issue", { outletId: outlet.id });
  const canAdjust = hasPermission(actor, "inventory.adjust", { outletId: outlet.id });
  const range = wasteParams.parse(raw);

  const [summary, items, recentList] = await Promise.all([
    wasteSummary(db, actor, outlet.id, range),
    canRecord ? listItemOptions(db, actor, outlet.id) : Promise.resolve([]),
    listMovements(db, actor, outlet.id, { types: ["waste", "expired", "damaged"], page: 1 }, 8),
  ]);
  const recent = recentList.rows;

  return (
    <>
      <PageHeader title="Waste" description={`${outlet.name} · rusak, kedaluwarsa, tumpah, salah produksi`}>
        <OutletSelect outlets={outlets} value={outlet.id} />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        {canRecord ? (
          <Card>
            <CardHeader>
              <CardTitle>Catat waste</CardTitle>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada item aktif.</p>
              ) : (
                <IssueForm items={items} mode="waste" />
              )}
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex flex-col gap-3">
              <CardTitle>Ringkasan {summary.from} s/d {summary.to}</CardTitle>
              <form method="get" className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                {raw.outlet ? <input type="hidden" name="outlet" value={raw.outlet} /> : null}
                <div className="flex flex-col gap-1">
                  <Label htmlFor="from" className="text-xs">Dari</Label>
                  <Input id="from" name="from" type="date" defaultValue={summary.from} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="to" className="text-xs">Sampai</Label>
                  <Input id="to" name="to" type="date" defaultValue={summary.to} />
                </div>
                <Button type="submit" variant="outline" className="col-span-2 sm:col-span-1">Terapkan</Button>
              </form>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {summary.totals.events === 0 ? (
                <p className="text-sm text-muted-foreground">Tidak ada waste pada periode ini.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border p-3">
                      <p className="text-xs text-muted-foreground">Catatan waste</p>
                      <p className="text-2xl font-semibold tabular-nums">{summary.totals.events}</p>
                    </div>
                    <div className="rounded-xl border p-3">
                      <p className="text-xs text-muted-foreground">Nilai (harga pokok)</p>
                      <p className="text-lg font-semibold tabular-nums">
                        {summary.totals.value === null ? "—" : formatRupiah(summary.totals.value)}
                      </p>
                      {summary.totals.uncosted ? (
                        <p className="text-xs text-muted-foreground">{summary.totals.uncosted} catatan tanpa harga pokok</p>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium">Per alasan</p>
                    <ul className="flex flex-col divide-y rounded-xl border">
                      {summary.byReason.map((r) => (
                        <li key={r.label} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span>{r.label}</span>
                          <span className="text-right text-muted-foreground tabular-nums">
                            {r.events}× · {r.value === null ? "—" : formatRupiah(r.value)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium">Per item</p>
                    <ul className="flex flex-col divide-y rounded-xl border">
                      {summary.byItem.map((r) => (
                        <li key={r.itemId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0 truncate">{r.name}</span>
                          <span className="text-right tabular-nums">
                            {formatQty(r.quantity, r.unit)}
                            <span className="block text-xs text-muted-foreground">{valueText(r.value, r.uncosted)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Waste terakhir</CardTitle>
            </CardHeader>
            <CardContent>
              {recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada waste tercatat.</p>
              ) : (
                <MovementList rows={recent} timezone={outlet.timezone} canReverse={canAdjust} compact />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
