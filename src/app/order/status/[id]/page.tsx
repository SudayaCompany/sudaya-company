import { CheckIcon, ClockIcon, CoffeeIcon, SearchXIcon, XCircleIcon } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { Brand } from "@/components/brand";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { formatPriceDelta, formatRupiah } from "@/lib/format";
import { getGuestOrder } from "@/lib/orders/engine";
import {
  ORDER_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  customerStatusLabel,
  type OrderStatus,
} from "@/lib/orders/state";
import { orderCookieName } from "@/lib/orders/tokens";
import { cn } from "@/lib/utils";

import { LiveStatus } from "./live-status";
import { PaymentDeadline } from "./payment-deadline";

// Token akses ada di cookie httpOnly. Referrer dimatikan & halaman tidak
// diindeks agar detail pesanan tidak bocor ke pihak ketiga.
export const metadata: Metadata = {
  title: "Status pesanan",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const STEPS: { status: OrderStatus[]; label: string }[] = [
  { status: ["queued", "paid"], label: "Diterima" },
  { status: ["preparing"], label: "Dibuat" },
  { status: ["ready"], label: "Siap" },
  { status: ["completed"], label: "Selesai" },
];

export default function OrderStatusPage({ params }: PageProps<"/order/status/[id]">) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-6">
      <Brand className="text-lg" />
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <OrderStatus params={params} />
      </Suspense>
    </div>
  );
}

async function OrderStatus({ params }: Pick<PageProps<"/order/status/[id]">, "params">) {
  const { id } = await params;
  const token = (await cookies()).get(orderCookieName(id))?.value;
  const order = await getGuestOrder(db, id, token);

  if (!order) {
    return (
      <EmptyState
        icon={SearchXIcon}
        title="Pesanan tidak ditemukan"
        description="Status hanya bisa dibuka dari perangkat yang dipakai saat memesan. Tanyakan ke kasir bila perlu bantuan."
      />
    );
  }

  const timeFormat = new Intl.DateTimeFormat("id-ID", { timeStyle: "short", dateStyle: "medium", timeZone: order.timezone });
  const unpaid = order.status === "pending_payment";
  const expired = order.status === "cancelled" && order.paymentStatus === "expired";
  const deadline = new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: order.timezone });
  const cancelled = order.status === "cancelled" || order.status === "refunded";
  const stepIndex = STEPS.findIndex((s) => s.status.includes(order.status));
  const finished = order.status === "completed" || cancelled;

  return (
    <>
      <section
        className={cn(
          "flex flex-col gap-4 rounded-2xl p-5",
          cancelled ? "bg-destructive/10" : unpaid ? "bg-brand/10" : "bg-neutral-950 text-white",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={cn("text-sm", unpaid || cancelled ? "text-muted-foreground" : "text-neutral-400")}>
              {order.orderNumber ? "Nomor antrean" : "Kode pesanan"}
            </p>
            <p className="font-mono text-4xl font-bold tracking-wider">{order.orderNumber ?? order.reference}</p>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold",
              cancelled ? "bg-destructive text-white" : unpaid ? "bg-brand text-brand-foreground" : "bg-success text-success-foreground",
            )}
          >
            {cancelled ? <XCircleIcon className="size-4" /> : unpaid ? <ClockIcon className="size-4" /> : <CoffeeIcon className="size-4" />}
            {customerStatusLabel(order.status)}
          </span>
        </div>

        {unpaid ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              Tunjukkan kode <span className="font-mono font-semibold">{order.reference}</span> ke kasir dan bayar{" "}
              <span className="font-semibold">{formatRupiah(order.total)}</span>. Nomor antrean muncul setelah pembayaran
              dikonfirmasi.
            </p>
            {order.expiresAt ? (
              <PaymentDeadline expiresAt={order.expiresAt.toISOString()} label={deadline.format(order.expiresAt)} />
            ) : null}
          </div>
        ) : expired ? (
          <p className="text-sm">
            Batas waktu pembayaran habis, pesanan dibatalkan otomatis. Silakan pesan lagi bila masih ingin memesan.
          </p>
        ) : cancelled ? (
          <p className="text-sm">Pesanan ini dibatalkan. Hubungi kasir untuk informasi lebih lanjut.</p>
        ) : (
          <ol className="grid grid-cols-4 gap-2" aria-label="Progres pesanan">
            {STEPS.map((step, index) => {
              const done = index <= stepIndex;
              return (
                <li key={step.label} className="flex flex-col items-center gap-1.5 text-center">
                  <span
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full border text-xs font-semibold",
                      done ? "border-brand bg-brand text-brand-foreground" : "border-white/30 text-neutral-400",
                    )}
                    aria-current={index === stepIndex ? "step" : undefined}
                  >
                    {done ? <CheckIcon className="size-4" /> : index + 1}
                  </span>
                  <span className={cn("text-xs", done ? "text-white" : "text-neutral-400")}>{step.label}</span>
                </li>
              );
            })}
          </ol>
        )}
        {order.status === "ready" ? (
          <p className="rounded-lg bg-brand px-3 py-2 text-center font-semibold text-brand-foreground">
            Pesanan siap — silakan ambil di counter.
          </p>
        ) : null}
        <LiveStatus topic={order.topic} active={!finished} />
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border p-4 text-sm">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5">
          <dt className="text-muted-foreground">Kode pesanan</dt>
          <dd className="font-mono">{order.reference}</dd>
          <dt className="text-muted-foreground">Nama</dt>
          <dd>{order.customerName ?? "—"}</dd>
          <dt className="text-muted-foreground">Tipe</dt>
          <dd>
            {ORDER_TYPE_LABELS[order.type]}
            {order.tableNumber ? ` · Meja ${order.tableNumber}` : ""}
          </dd>
          <dt className="text-muted-foreground">Outlet</dt>
          <dd>{order.outletName}</dd>
          <dt className="text-muted-foreground">Dipesan</dt>
          <dd>{timeFormat.format(order.createdAt)}</dd>
          <dt className="text-muted-foreground">Pembayaran</dt>
          <dd>
            {order.paymentMethod === "cash" ? "Tunai" : order.paymentMethod ?? "—"} · {PAYMENT_STATUS_LABELS[order.paymentStatus]}
          </dd>
        </dl>

        <ul className="flex flex-col divide-y border-t">
          {order.lines.map((line) => (
            <li key={line.id} className="flex gap-3 py-2.5">
              <span className="font-medium tabular-nums">{line.quantity}×</span>
              <div className="flex-1">
                <p className="font-medium">{line.productName}</p>
                {line.modifiers.length ? (
                  <p className="text-xs text-muted-foreground">
                    {line.modifiers.map((m) => `${m.name}${m.priceDelta ? ` (${formatPriceDelta(m.priceDelta)})` : ""}`).join(", ")}
                  </p>
                ) : null}
                {line.notes ? <p className="text-xs text-muted-foreground italic">“{line.notes}”</p> : null}
              </div>
              <span className="tabular-nums">{formatRupiah(line.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t pt-3 text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatRupiah(order.total)}</span>
        </div>
      </section>

      <Link href={`/order?outlet=${order.outletCode}`} className={buttonVariants({ variant: "outline", size: "lg" })}>
        Pesan lagi
      </Link>
    </>
  );
}
