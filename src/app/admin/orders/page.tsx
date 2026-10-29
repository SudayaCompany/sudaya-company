import { ReceiptTextIcon, SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/orders/order-badges";
import { PageHeader, PageSkeleton } from "@/components/page-header";
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
import { requirePermission } from "@/lib/auth/session";
import { formatRupiah } from "@/lib/format";
import { listOrders, orderListParams } from "@/lib/orders/engine";
import {
  CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type OrderChannel,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/orders/state";
import { firstValues, toQuery } from "@/lib/search-params";

export const metadata: Metadata = { title: "Order" };

export default function AdminOrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Orders searchParams={searchParams} />
    </Suspense>
  );
}

async function Orders({ searchParams }: Pick<PageProps<"/admin/orders">, "searchParams">) {
  const actor = await requirePermission("order.view");
  const params = orderListParams.parse(firstValues(await searchParams));
  const list = await listOrders(db, actor, params);
  const filters = {
    q: params.q,
    from: params.from,
    to: params.to,
    channel: params.channel,
    payment: params.payment,
    status: params.status,
    outlet: params.outlet,
  };

  return (
    <>
      <PageHeader title="Order" description={`${list.total} transaksi · data tersimpan permanen, perubahan tercatat di riwayat`} />

      <form method="get" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <div className="relative sm:col-span-2">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={params.q} placeholder="Nomor, kode, atau nama" aria-label="Cari order" className="pl-8" />
        </div>
        <Input type="date" name="from" defaultValue={params.from} aria-label="Dari tanggal" />
        <Input type="date" name="to" defaultValue={params.to} aria-label="Sampai tanggal" />
        <NativeSelect name="channel" defaultValue={params.channel ?? ""} aria-label="Channel" className="w-full">
          <NativeSelectOption value="">Semua channel</NativeSelectOption>
          {(Object.keys(CHANNEL_LABELS) as OrderChannel[]).map((c) => (
            <NativeSelectOption key={c} value={c}>{CHANNEL_LABELS[c]}</NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="payment" defaultValue={params.payment ?? ""} aria-label="Status pembayaran" className="w-full">
          <NativeSelectOption value="">Semua pembayaran</NativeSelectOption>
          {(["pending", "paid", "expired", "refunded"] as PaymentStatus[]).map((p) => (
            <NativeSelectOption key={p} value={p}>{PAYMENT_STATUS_LABELS[p]}</NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="status" defaultValue={params.status ?? ""} aria-label="Status produksi" className="w-full">
          <NativeSelectOption value="">Semua status</NativeSelectOption>
          <NativeSelectOption value="active">Sedang diproses</NativeSelectOption>
          {(["pending_payment", "queued", "preparing", "ready", "completed", "cancelled"] as OrderStatus[]).map((s) => (
            <NativeSelectOption key={s} value={s}>{ORDER_STATUS_LABELS[s]}</NativeSelectOption>
          ))}
        </NativeSelect>
        <div className="flex gap-2">
          {list.outlets.length > 1 ? (
            <NativeSelect name="outlet" defaultValue={params.outlet ?? ""} aria-label="Outlet" className="w-full">
              <NativeSelectOption value="">Semua outlet</NativeSelectOption>
              {list.outlets.map((o) => (
                <NativeSelectOption key={o.id} value={o.id}>{o.name}</NativeSelectOption>
              ))}
            </NativeSelect>
          ) : null}
          <Button type="submit" variant="outline">Terapkan</Button>
        </div>
      </form>

      {list.rows.length === 0 ? (
        <EmptyState icon={ReceiptTextIcon} title="Belum ada order" description="Order dari POS, QR, web, dan kiosk tampil di sini." />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nomor</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Pembayaran</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((order) => {
                  const time = new Intl.DateTimeFormat("id-ID", { dateStyle: "short", timeStyle: "short", timeZone: order.timezone });
                  return (
                    <TableRow key={order.id}>
                      <TableCell>
                        <Link href={`/admin/orders/${order.id}`} className="font-mono font-semibold underline-offset-4 hover:underline">
                          {order.orderNumber ?? order.reference}
                        </Link>
                        {order.orderNumber ? <p className="font-mono text-xs text-muted-foreground">{order.reference}</p> : null}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{time.format(order.createdAt)}</TableCell>
                      <TableCell className="text-sm">
                        {order.customerName ?? "—"}
                        {list.outlets.length > 1 ? <p className="text-xs text-muted-foreground">{order.outletName}</p> : null}
                      </TableCell>
                      <TableCell className="text-sm">{CHANNEL_LABELS[order.channel]}</TableCell>
                      <TableCell><PaymentStatusBadge status={order.paymentStatus} /></TableCell>
                      <TableCell><OrderStatusBadge status={order.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(order.total)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {list.pageCount > 1 ? (
        <nav aria-label="Halaman" className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Halaman {list.page} dari {list.pageCount}</span>
          <div className="flex gap-2">
            {list.page > 1 ? (
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/admin/orders${toQuery({ ...filters, page: list.page - 1 })}`}>
                Sebelumnya
              </Link>
            ) : null}
            {list.page < list.pageCount ? (
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/admin/orders${toQuery({ ...filters, page: list.page + 1 })}`}>
                Berikutnya
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </>
  );
}
