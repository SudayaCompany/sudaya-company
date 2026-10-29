import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { db } from "@/db";
import { AccessError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/session";
import { formatRupiah } from "@/lib/format";
import { getOrderDetail } from "@/lib/orders/engine";
import { ORDER_TYPE_LABELS } from "@/lib/orders/state";

import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Struk", robots: { index: false } };

// Struk 58–80 mm dicetak lewat dialog print browser (PRD §46).
export default function ReceiptPage({ params }: PageProps<"/pos/orders/[id]/receipt">) {
  return (
    <Suspense fallback={null}>
      <Receipt params={params} />
    </Suspense>
  );
}

async function Receipt({ params }: Pick<PageProps<"/pos/orders/[id]/receipt">, "params">) {
  const actor = await requirePermission("order.view");
  const { id } = await params;
  const order = await getOrderDetail(db, actor, id).catch((error: unknown) => {
    if (error instanceof AccessError) notFound();
    throw error;
  });
  const time = new Intl.DateTimeFormat("id-ID", { dateStyle: "short", timeStyle: "short", timeZone: order.outlet.timezone });
  const payment = order.payments.find((p) => p.status === "paid");

  return (
    <div className="flex flex-col items-center gap-4 p-4 print:p-0">
      <PrintButton />
      <article className="w-[76mm] bg-white p-3 font-mono text-[12px] leading-snug text-black shadow print:shadow-none">
        <header className="text-center">
          <p className="text-base font-bold">SUDAYA COFFEE</p>
          <p>{order.outlet.name}</p>
        </header>
        <hr className="my-2 border-dashed border-black" />
        <p className="text-center text-2xl font-bold">{order.orderNumber ?? order.reference}</p>
        {order.orderNumber ? <p className="text-center">Kode {order.reference}</p> : null}
        <p>{time.format(order.createdAt)}</p>
        <p>
          {ORDER_TYPE_LABELS[order.type]}
          {order.tableNumber ? ` · Meja ${order.tableNumber}` : ""}
        </p>
        {order.customerName ? <p>Customer: {order.customerName}</p> : null}
        {payment?.confirmedByName ? <p>Kasir: {payment.confirmedByName}</p> : null}
        <hr className="my-2 border-dashed border-black" />
        {order.lines.map((line) => (
          <div key={line.id} className="mb-1">
            <div className="flex justify-between gap-2">
              <span>
                {line.quantity}x {line.productName}
              </span>
              <span>{formatRupiah(line.lineTotal)}</span>
            </div>
            {line.modifiers.map((m) => (
              <p key={m.name} className="pl-3">
                - {m.name}
                {m.priceDelta ? ` (${formatRupiah(m.priceDelta)})` : ""}
              </p>
            ))}
            {line.notes ? <p className="pl-3">* {line.notes}</p> : null}
          </div>
        ))}
        <hr className="my-2 border-dashed border-black" />
        <div className="flex justify-between text-sm font-bold">
          <span>TOTAL</span>
          <span>{formatRupiah(order.total)}</span>
        </div>
        {payment ? (
          <>
            <div className="flex justify-between">
              <span>Tunai</span>
              <span>{formatRupiah(payment.tenderedAmount ?? payment.amount)}</span>
            </div>
            <div className="flex justify-between">
              <span>Kembali</span>
              <span>{formatRupiah(payment.changeAmount ?? 0)}</span>
            </div>
          </>
        ) : (
          <p className="mt-1 text-center font-bold">*** BELUM DIBAYAR ***</p>
        )}
        {order.status === "cancelled" ? <p className="mt-1 text-center font-bold">*** DIBATALKAN ***</p> : null}
        <hr className="my-2 border-dashed border-black" />
        <p className="text-center">Terima kasih!</p>
      </article>
    </div>
  );
}
