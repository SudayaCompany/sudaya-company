import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { OutletSelect } from "@/components/inventory/outlet-select";
import { PageHeader, PageSkeleton } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { hasPermission } from "@/lib/auth/policy";
import { requirePermission } from "@/lib/auth/session";
import { listItemOptions, listMovements } from "@/lib/inventory/queries";
import { firstValues, toQuery } from "@/lib/search-params";

import { IssueForm } from "../issue-form";
import { MovementList } from "../movement-list";
import { resolveInventoryOutlet } from "../scope";

export const metadata: Metadata = { title: "Stok keluar" };

export default function StockOutPage({ searchParams }: PageProps<"/admin/inventory/stock-out">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StockOut searchParams={searchParams} />
    </Suspense>
  );
}

async function StockOut({ searchParams }: Pick<PageProps<"/admin/inventory/stock-out">, "searchParams">) {
  const actor = await requirePermission("inventory.issue");
  const raw = firstValues(await searchParams);
  const { outlets, outlet } = await resolveInventoryOutlet(actor, "inventory.issue", raw.outlet);
  const canAdjust = hasPermission(actor, "inventory.adjust", { outletId: outlet.id });
  const [items, recentList] = await Promise.all([
    listItemOptions(db, actor, outlet.id),
    listMovements(db, actor, outlet.id, { types: ["internal_use", "stock_out"], page: 1 }, 8),
  ]);
  const recent = recentList.rows;

  return (
    <>
      <PageHeader title="Stok keluar" description={`${outlet.name} · pemakaian internal & stok keluar lainnya`}>
        <OutletSelect outlets={outlets} value={outlet.id} />
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Barang rusak/kedaluwarsa/tumpah dicatat di{" "}
              <Link href={`/admin/inventory/waste${toQuery({ outlet: raw.outlet })}`} className="underline">Waste</Link>.
              {canAdjust ? (
                <>
                  {" "}Koreksi selisih stok (perlu approval) ada di{" "}
                  <Link href={`/admin/inventory/movements${toQuery({ outlet: raw.outlet })}`} className="underline">Mutasi</Link>.
                </>
              ) : null}
            </p>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada item aktif.</p>
            ) : (
              <IssueForm items={items} mode="out" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Stok keluar terakhir</CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada stok keluar tercatat.</p>
            ) : (
              <MovementList rows={recent} timezone={outlet.timezone} canReverse={canAdjust} compact />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
