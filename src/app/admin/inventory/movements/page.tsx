import { ArrowLeftRightIcon, SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { OutletSelect } from "@/components/inventory/outlet-select";
import { PageHeader, PageSkeleton } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { db } from "@/db";
import { hasPermission } from "@/lib/auth/policy";
import { requirePermission } from "@/lib/auth/session";
import { MOVEMENT_LABELS } from "@/lib/inventory/labels";
import {
  MOVEMENT_TYPES,
  listItemOptions,
  listMovements,
  listPendingStockApprovals,
  movementListParams,
} from "@/lib/inventory/queries";
import { firstValues, toQuery } from "@/lib/search-params";

import { MovementList } from "../movement-list";
import { PendingApprovals } from "../pending-approvals";
import { resolveInventoryOutlet } from "../scope";

import { AdjustmentDialog } from "./adjustment-dialog";

export const metadata: Metadata = { title: "Mutasi stok" };

export default function MovementsPage({ searchParams }: PageProps<"/admin/inventory/movements">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Movements searchParams={searchParams} />
    </Suspense>
  );
}

async function Movements({ searchParams }: Pick<PageProps<"/admin/inventory/movements">, "searchParams">) {
  const actor = await requirePermission("inventory.view");
  const raw = firstValues(await searchParams);
  const params = movementListParams.parse(raw);
  const { outlets, outlet } = await resolveInventoryOutlet(actor, "inventory.view", raw.outlet);
  const canAdjust = hasPermission(actor, "inventory.adjust", { outletId: outlet.id });

  const [list, pending, items] = await Promise.all([
    listMovements(db, actor, outlet.id, params),
    listPendingStockApprovals(db, actor, outlet.id),
    canAdjust ? listItemOptions(db, actor, outlet.id) : Promise.resolve([]),
  ]);
  const filters = { outlet: raw.outlet, q: params.q, type: params.type, item: params.item, from: params.from, to: params.to };
  const hasFilters = Boolean(params.q || params.type || params.item || params.from || params.to);

  return (
    <>
      <PageHeader title="Mutasi stok" description={`${outlet.name} · ledger append-only, ${list.total} movement`}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <OutletSelect outlets={outlets} value={outlet.id} />
          {canAdjust && items.length ? <AdjustmentDialog items={items} /> : null}
        </div>
      </PageHeader>

      {pending.length ? (
        <Card id="approval">
          <CardHeader>
            <CardTitle>Menunggu approval ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <PendingApprovals rows={pending} timezone={outlet.timezone} />
          </CardContent>
        </Card>
      ) : null}

      <form method="get" className="grid grid-cols-2 gap-2 lg:grid-cols-[1fr_auto_auto_auto_auto]">
        {raw.outlet ? <input type="hidden" name="outlet" value={raw.outlet} /> : null}
        {params.item ? <input type="hidden" name="item" value={params.item} /> : null}
        <div className="relative col-span-2 lg:col-span-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" type="search" defaultValue={params.q} placeholder="Cari item, SKU, atau no. referensi" className="pl-8" aria-label="Cari mutasi" />
        </div>
        <NativeSelect name="type" defaultValue={params.type ?? ""} aria-label="Jenis" className="col-span-2 w-full lg:col-span-1">
          <NativeSelectOption value="">Semua jenis</NativeSelectOption>
          {MOVEMENT_TYPES.map((t) => (
            <NativeSelectOption key={t} value={t}>{MOVEMENT_LABELS[t]}</NativeSelectOption>
          ))}
        </NativeSelect>
        <Input name="from" type="date" defaultValue={params.from} aria-label="Dari tanggal" />
        <Input name="to" type="date" defaultValue={params.to} aria-label="Sampai tanggal" />
        <Button type="submit" variant="outline" className="col-span-2 lg:col-span-1">Terapkan</Button>
      </form>

      {list.rows.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRightIcon}
          title={hasFilters ? "Tidak ada mutasi yang cocok" : "Belum ada mutasi"}
          description={hasFilters ? "Ubah kata kunci atau filter." : "Mutasi muncul setelah stok masuk, keluar, waste, penjualan, atau opname."}
        />
      ) : (
        <Card>
          <CardContent>
            <MovementList rows={list.rows} timezone={outlet.timezone} canReverse={canAdjust} />
          </CardContent>
        </Card>
      )}

      {list.pageCount > 1 ? (
        <nav aria-label="Halaman" className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Halaman {list.page} dari {list.pageCount}
          </span>
          <div className="flex gap-2">
            {list.page > 1 ? (
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/admin/inventory/movements${toQuery({ ...filters, page: list.page - 1 })}`}>
                Sebelumnya
              </Link>
            ) : null}
            {list.page < list.pageCount ? (
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/admin/inventory/movements${toQuery({ ...filters, page: list.page + 1 })}`}>
                Berikutnya
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </>
  );
}
