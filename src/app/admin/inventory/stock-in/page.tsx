import type { Metadata } from "next";
import { Suspense } from "react";

import { OutletSelect } from "@/components/inventory/outlet-select";
import { PageHeader, PageSkeleton } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { hasPermission } from "@/lib/auth/policy";
import { requirePermission } from "@/lib/auth/session";
import { listItemOptions, listMovements } from "@/lib/inventory/queries";
import { businessDateIn } from "@/lib/orders/dates";
import { firstValues } from "@/lib/search-params";

import { MovementList } from "../movement-list";
import { resolveInventoryOutlet } from "../scope";

import { StockInForm } from "./stock-in-form";

export const metadata: Metadata = { title: "Stok masuk" };

export default function StockInPage({ searchParams }: PageProps<"/admin/inventory/stock-in">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StockIn searchParams={searchParams} />
    </Suspense>
  );
}

async function StockIn({ searchParams }: Pick<PageProps<"/admin/inventory/stock-in">, "searchParams">) {
  const actor = await requirePermission("inventory.receive");
  const raw = firstValues(await searchParams);
  const { outlets, outlet } = await resolveInventoryOutlet(actor, "inventory.receive", raw.outlet);
  const [items, recent] = await Promise.all([
    listItemOptions(db, actor, outlet.id),
    listMovements(db, actor, outlet.id, { types: ["purchase", "return"], page: 1 }, 10),
  ]);

  return (
    <>
      <PageHeader title="Stok masuk" description={`${outlet.name} · pembelian & retur masuk menambah saldo`}>
        <OutletSelect outlets={outlets} value={outlet.id} />
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <Card>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada item aktif. Tambahkan item di menu Item.</p>
            ) : (
              <StockInForm items={items} today={businessDateIn(outlet.timezone)} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Stok masuk terakhir</CardTitle>
          </CardHeader>
          <CardContent>
            {recent.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada stok masuk tercatat.</p>
            ) : (
              <MovementList
                rows={recent.rows}
                timezone={outlet.timezone}
                canReverse={hasPermission(actor, "inventory.adjust", { outletId: outlet.id })}
                compact
              />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
