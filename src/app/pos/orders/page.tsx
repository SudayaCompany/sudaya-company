import { ReceiptTextIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { LiveRefresh } from "@/components/orders/live-refresh";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/orders/order-badges";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { formatRupiah } from "@/lib/format";
import { businessDateIn } from "@/lib/orders/dates";
import { listOrders, orderListParams } from "@/lib/orders/engine";
import { outletOrdersTopic } from "@/lib/orders/realtime";
import { CHANNEL_LABELS, ORDER_TYPE_LABELS } from "@/lib/orders/state";
import { firstValues, toQuery } from "@/lib/search-params";
import { cn } from "@/lib/utils";

import { resolveStaffOutlet } from "../pos-outlet";

export const metadata: Metadata = { title: "Pesanan" };

const VIEWS = [
  { id: "pending", label: "Menunggu bayar", status: "pending_payment" },
  { id: "active", label: "Diproses", status: "active" },
  { id: "today", label: "Semua hari ini", status: undefined },
] as const;

export default function PosOrdersPage({ searchParams }: PageProps<"/pos/orders">) {
  return (
    <Suspense fallback={<Skeleton className="m-4 h-96 rounded-xl" />}>
      <PosOrders searchParams={searchParams} />
    </Suspense>
  );
}

async function PosOrders({ searchParams }: Pick<PageProps<"/pos/orders">, "searchParams">) {
  const actor = await requirePermission("order.view");
  const params = firstValues(await searchParams);
  const { outlet } = await resolveStaffOutlet(actor, "order.view", params.outlet);
  const view = VIEWS.find((v) => v.id === params.view) ?? VIEWS[0];
  const today = businessDateIn(outlet.timezone);

  const list = await listOrders(
    db,
    actor,
    orderListParams.parse({ outlet: outlet.id, from: today, to: today, status: view.status, q: params.q }),
  );
  const time = new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: outlet.timezone });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Pesanan hari ini</h1>
          <p className="text-sm text-muted-foreground">{outlet.name}</p>
        </div>
        <LiveRefresh topic={outletOrdersTopic(outlet.id)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            href={`/pos/orders${toQuery({ outlet: outlet.id, view: v.id })}`}
            aria-current={v.id === view.id ? "page" : undefined}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-medium",
              v.id === view.id ? "border-neutral-950 bg-neutral-950 text-white" : "bg-background hover:border-foreground",
            )}
          >
            {v.label}
          </Link>
        ))}
        <form className="ml-auto flex gap-2" method="get">
          <input type="hidden" name="outlet" value={outlet.id} />
          <input type="hidden" name="view" value={view.id} />
          <input
            name="q"
            defaultValue={params.q}
            placeholder="Kode / nomor / nama"
            aria-label="Cari pesanan"
            className="h-9 rounded-lg border bg-background px-3 text-sm"
          />
        </form>
      </div>

      {list.rows.length === 0 ? (
        <EmptyState
          icon={ReceiptTextIcon}
          title="Tidak ada pesanan"
          description={view.id === "pending" ? "Pesanan self-service yang menunggu pembayaran tampil di sini." : "Belum ada pesanan pada filter ini."}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.rows.map((order) => (
            <li key={order.id}>
              <Link
                href={`/pos/orders/${order.id}${toQuery({ outlet: outlet.id })}`}
                className="flex flex-wrap items-center gap-3 rounded-xl border bg-background p-3 transition-colors hover:border-foreground"
              >
                <span className="w-24 font-mono text-lg font-bold">{order.orderNumber ?? order.reference}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{order.customerName ?? "Walk-in"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {CHANNEL_LABELS[order.channel]} · {ORDER_TYPE_LABELS[order.type]}
                    {order.tableNumber ? ` · Meja ${order.tableNumber}` : ""} · {time.format(order.createdAt)}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <PaymentStatusBadge status={order.paymentStatus} />
                  <OrderStatusBadge status={order.status} />
                </span>
                <span className="w-24 text-right font-semibold tabular-nums">{formatRupiah(order.total)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
