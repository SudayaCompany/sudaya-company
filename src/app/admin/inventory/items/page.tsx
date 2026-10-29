import { PackageIcon, SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { OutletSelect } from "@/components/inventory/outlet-select";
import { StockBadge, stockAccent } from "@/components/inventory/stock-badge";
import { PageHeader, PageSkeleton } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import { hasPermission } from "@/lib/auth/policy";
import { requirePermission } from "@/lib/auth/session";
import { formatRupiah } from "@/lib/format";
import { itemListParams, listItems, productLinkOptions, type ItemRow } from "@/lib/inventory/queries";
import { ITEM_KIND_LABELS, ITEM_KINDS } from "@/lib/inventory/schemas";
import { formatQty, formatUnitCost } from "@/lib/inventory/units";
import { businessDateIn } from "@/lib/orders/dates";
import { firstValues, toQuery } from "@/lib/search-params";
import { cn } from "@/lib/utils";

import { resolveInventoryOutlet } from "../scope";

import { ItemDialog, LinkProductsDialog, OpeningBalanceDialog, type ProductOption } from "./item-dialogs";

export const metadata: Metadata = { title: "Item stok" };

export default function ItemsPage({ searchParams }: PageProps<"/admin/inventory/items">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Items searchParams={searchParams} />
    </Suspense>
  );
}

function ItemActions({
  item,
  outletId,
  categories,
  canEdit,
  products,
}: {
  item: ItemRow;
  outletId: string;
  categories: string[];
  canEdit: boolean;
  products: ProductOption[] | null;
}) {
  if (!canEdit) return null;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <ItemDialog outletId={outletId} categories={categories} item={item} />
      {item.kind === "finished_good" && products ? (
        <LinkProductsDialog item={item} products={products} />
      ) : null}
      {!item.hasMovements ? <OpeningBalanceDialog item={item} /> : null}
    </div>
  );
}

function Expiry({ date, today }: { date: string | null; today: string }) {
  if (!date) return null;
  const expired = date < today;
  return (
    <span className={cn("text-xs", expired ? "font-medium text-destructive" : "text-muted-foreground")}>
      {expired ? "Kedaluwarsa" : "Exp"} {date}
    </span>
  );
}

async function Items({ searchParams }: Pick<PageProps<"/admin/inventory/items">, "searchParams">) {
  const actor = await requirePermission("inventory.view");
  const raw = firstValues(await searchParams);
  const params = itemListParams.parse(raw);
  const { outlets, outlet } = await resolveInventoryOutlet(actor, "inventory.view", raw.outlet);
  const canEdit = hasPermission(actor, "inventory.adjust", { outletId: outlet.id });
  const canLink = canEdit && hasPermission(actor, "product.edit", { outletId: outlet.id });

  const [list, products] = await Promise.all([
    listItems(db, actor, outlet.id, params),
    canLink ? productLinkOptions(db, actor, outlet.id) : Promise.resolve(null),
  ]);
  const today = businessDateIn(outlet.timezone);

  const filters = {
    outlet: raw.outlet,
    q: params.q,
    kind: params.kind,
    level: params.level,
    status: params.status === "active" ? undefined : params.status,
    category: params.category,
  };
  const hasFilters = Boolean(params.q || params.kind || params.level || params.category || filters.status);

  return (
    <>
      <PageHeader title="Item stok" description={`${outlet.name} · ${list.total} item`}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <OutletSelect outlets={outlets} value={outlet.id} />
          {canEdit ? <ItemDialog outletId={outlet.id} categories={list.categories} /> : null}
        </div>
      </PageHeader>

      <form method="get" className="grid grid-cols-2 gap-2 lg:grid-cols-[1fr_auto_auto_auto_auto_auto]">
        {raw.outlet ? <input type="hidden" name="outlet" value={raw.outlet} /> : null}
        <div className="relative col-span-2 lg:col-span-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" type="search" defaultValue={params.q} placeholder="Cari nama atau SKU" className="pl-8" aria-label="Cari item" />
        </div>
        <NativeSelect name="level" defaultValue={params.level ?? ""} aria-label="Level stok" className="w-full">
          <NativeSelectOption value="">Semua level</NativeSelectOption>
          <NativeSelectOption value="out">🔴 Habis</NativeSelectOption>
          <NativeSelectOption value="low">🟡 Menipis</NativeSelectOption>
          <NativeSelectOption value="ok">🟢 Aman</NativeSelectOption>
        </NativeSelect>
        <NativeSelect name="kind" defaultValue={params.kind ?? ""} aria-label="Jenis" className="w-full">
          <NativeSelectOption value="">Semua jenis</NativeSelectOption>
          {ITEM_KINDS.map((k) => (
            <NativeSelectOption key={k} value={k}>{ITEM_KIND_LABELS[k]}</NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="category" defaultValue={params.category ?? ""} aria-label="Kategori" className="w-full">
          <NativeSelectOption value="">Semua kategori</NativeSelectOption>
          {list.categories.map((c) => (
            <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="status" defaultValue={params.status} aria-label="Status" className="w-full">
          <NativeSelectOption value="active">Aktif</NativeSelectOption>
          <NativeSelectOption value="inactive">Nonaktif</NativeSelectOption>
          <NativeSelectOption value="all">Semua status</NativeSelectOption>
        </NativeSelect>
        <Button type="submit" variant="outline" className="col-span-2 lg:col-span-1">Terapkan</Button>
      </form>

      {list.rows.length === 0 ? (
        <EmptyState
          icon={PackageIcon}
          title={hasFilters ? "Tidak ada item yang cocok" : "Belum ada item stok"}
          description={hasFilters ? "Ubah kata kunci atau filter." : "Tambahkan bahan baku, kemasan, atau produk jadi."}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {list.rows.map((item) => (
              <li key={item.id} className={cn("flex flex-col gap-2 rounded-xl border border-l-4 p-3", stockAccent(item.level))}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {item.sku} · {ITEM_KIND_LABELS[item.kind]}
                      {item.category ? ` · ${item.category}` : ""}
                    </p>
                  </div>
                  <StockBadge level={item.level} />
                </div>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-xl font-semibold tabular-nums">{formatQty(item.stockQty, item.unit)}</p>
                    <p className="text-xs text-muted-foreground">Min {formatQty(item.minimumStock, item.unit)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 text-right">
                    {!item.isActive ? <Badge variant="outline">Nonaktif</Badge> : null}
                    <Expiry date={item.expiryDate} today={today} />
                    {item.linkedProducts.length ? (
                      <span className="text-xs text-muted-foreground">Menu: {item.linkedProducts.join(", ")}</span>
                    ) : null}
                  </div>
                </div>
                <ItemActions item={item} outletId={outlet.id} categories={list.categories} canEdit={canEdit} products={products} />
              </li>
            ))}
          </ul>

          <Card className="hidden md:block">
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Jenis</TableHead>
                    <TableHead className="text-right">Stok</TableHead>
                    <TableHead className="text-right">Minimum</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Harga pokok</TableHead>
                    <TableHead className="text-right">Nilai stok</TableHead>
                    {canEdit ? <TableHead className="text-right">Aksi</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.rows.map((item) => (
                    <TableRow key={item.id} className={cn(!item.isActive && "opacity-60")}>
                      <TableCell>
                        <p className="font-medium">{item.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {item.sku}
                          {item.category ? ` · ${item.category}` : ""}
                        </p>
                        {item.linkedProducts.length ? (
                          <p className="text-xs text-muted-foreground">Menu: {item.linkedProducts.join(", ")}</p>
                        ) : null}
                        <Expiry date={item.expiryDate} today={today} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {ITEM_KIND_LABELS[item.kind]}
                        {!item.isActive ? <Badge variant="outline" className="ml-2">Nonaktif</Badge> : null}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatQty(item.stockQty, item.unit)}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                        {formatQty(item.minimumStock, item.unit)}
                      </TableCell>
                      <TableCell>
                        <StockBadge level={item.level} />
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {item.purchasePrice === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          formatUnitCost(item.purchasePrice, item.unit)
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {item.stockValue === null ? <span className="text-muted-foreground">—</span> : formatRupiah(item.stockValue)}
                      </TableCell>
                      {canEdit ? (
                        <TableCell>
                          <ItemActions item={item} outletId={outlet.id} categories={list.categories} canEdit={canEdit} products={products} />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {list.pageCount > 1 ? (
        <nav aria-label="Halaman" className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Halaman {list.page} dari {list.pageCount}
          </span>
          <div className="flex gap-2">
            {list.page > 1 ? (
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/admin/inventory/items${toQuery({ ...filters, page: list.page - 1 })}`}>
                Sebelumnya
              </Link>
            ) : null}
            {list.page < list.pageCount ? (
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/admin/inventory/items${toQuery({ ...filters, page: list.page + 1 })}`}>
                Berikutnya
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </>
  );
}
