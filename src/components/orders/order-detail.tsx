import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRupiah } from "@/lib/format";
import type { OrderDetail } from "@/lib/orders/engine";
import { CHANNEL_LABELS, ORDER_TYPE_LABELS } from "@/lib/orders/state";

import { OrderActions, type OrderActionFlags } from "./order-actions";
import { OrderStatusBadge, PaymentStatusBadge } from "./order-badges";
import { OrderLines } from "./order-lines";

const HISTORY_LABELS: Record<string, string> = {
  "order.created": "Pesanan dibuat",
  "payment.confirmed": "Pembayaran dikonfirmasi",
  "order.queued": "Masuk antrean",
  "order.preparing": "Mulai dibuat",
  "order.ready": "Siap diambil",
  "order.completed": "Selesai",
  "order.status_override": "Koreksi status (override)",
  "order.cancel_requested": "Pembatalan diajukan",
  "approval.approved": "Pembatalan disetujui",
  "approval.rejected": "Pembatalan ditolak",
  "order.cancelled": "Dibatalkan",
  "order.expired": "Kedaluwarsa (tidak dibayar tepat waktu)",
  "inventory.sale_posted": "Stok produk jadi dipotong",
};

const METHOD_LABELS: Record<string, string> = { cash: "Tunai", qris: "QRIS" };

/** Detail order untuk staf (POS & admin). Riwayat diambil dari audit log. */
export function OrderDetailView({
  order,
  flags,
  receiptHref,
}: {
  order: OrderDetail;
  flags: OrderActionFlags;
  receiptHref: string;
}) {
  const time = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: order.outlet.timezone,
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-2xl">{order.orderNumber ?? order.reference}</span>
              <OrderStatusBadge status={order.status} />
              <PaymentStatusBadge status={order.paymentStatus} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[8rem_1fr]">
              <dt className="text-muted-foreground">Kode</dt>
              <dd className="font-mono">{order.reference}</dd>
              <dt className="text-muted-foreground">Channel</dt>
              <dd>{CHANNEL_LABELS[order.channel]}</dd>
              <dt className="text-muted-foreground">Tipe</dt>
              <dd>
                {ORDER_TYPE_LABELS[order.type]}
                {order.tableNumber ? ` · Meja ${order.tableNumber}` : ""}
              </dd>
              <dt className="text-muted-foreground">Customer</dt>
              <dd>
                {order.customerName ?? "—"}
                {order.customerPhone ? ` · ${order.customerPhone}` : ""}
              </dd>
              {order.deliveryAddress ? (
                <>
                  <dt className="text-muted-foreground">Alamat</dt>
                  <dd>{order.deliveryAddress}</dd>
                </>
              ) : null}
              {order.notes ? (
                <>
                  <dt className="text-muted-foreground">Catatan</dt>
                  <dd className="italic">“{order.notes}”</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Outlet</dt>
              <dd>{order.outlet.name}</dd>
              <dt className="text-muted-foreground">Dibuat</dt>
              <dd>
                {time.format(order.createdAt)}
                {order.createdByName ? ` · ${order.createdByName}` : " · customer"}
              </dd>
              {order.cancelReason ? (
                <>
                  <dt className="text-muted-foreground">Alasan batal</dt>
                  <dd className="text-destructive">{order.cancelReason}</dd>
                </>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Item</CardTitle>
          </CardHeader>
          <CardContent>
            <OrderLines lines={order.lines} total={order.total} />
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Pembayaran</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {order.payments.map((p) => (
              <div key={p.id} className="flex flex-col gap-0.5 rounded-lg border p-3">
                <div className="flex justify-between font-medium">
                  <span>{METHOD_LABELS[p.method] ?? p.method}</span>
                  <PaymentStatusBadge status={p.status} />
                </div>
                <p className="tabular-nums">{formatRupiah(p.amount)}</p>
                {p.tenderedAmount !== null ? (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Diterima {formatRupiah(p.tenderedAmount)} · Kembali {formatRupiah(p.changeAmount ?? 0)}
                  </p>
                ) : null}
                {p.paidAt ? (
                  <p className="text-xs text-muted-foreground">
                    {time.format(p.paidAt)}
                    {p.confirmedByName ? ` · ${p.confirmedByName}` : ""}
                  </p>
                ) : null}
              </div>
            ))}
            {order.status === "cancelled" && order.paymentStatus === "paid" ? (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Pesanan dibatalkan setelah dibayar. Pengembalian uang diproses terpisah (refund).
              </p>
            ) : null}
            <OrderActions
              orderId={order.id}
              total={order.total}
              status={order.status}
              paymentStatus={order.paymentStatus}
              pendingApproval={order.pendingApproval}
              flags={{
                ...flags,
                // Pemohon tidak bisa memutuskan pengajuannya sendiri (dicek juga di server).
                canDecide: flags.canDecide,
              }}
              receiptHref={receiptHref}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Riwayat</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3 border-l pl-4 text-sm">
              {order.history.map((event) => (
                <li key={event.id} className="relative">
                  <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-brand" aria-hidden />
                  <p className="font-medium">{HISTORY_LABELS[event.action] ?? event.action}</p>
                  <p className="text-xs text-muted-foreground">
                    {time.format(event.createdAt)} · {event.actorName ?? "Customer/Sistem"}
                  </p>
                  {event.reason ? <p className="text-xs italic">“{event.reason}”</p> : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
