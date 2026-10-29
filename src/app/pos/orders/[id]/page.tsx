import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { LiveRefresh } from "@/components/orders/live-refresh";
import { OrderDetailView } from "@/components/orders/order-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { AccessError } from "@/lib/auth/errors";
import { hasPermission } from "@/lib/auth/policy";
import { requirePermission } from "@/lib/auth/session";
import { getOrderDetail } from "@/lib/orders/engine";
import { outletOrdersTopic } from "@/lib/orders/realtime";

export const metadata: Metadata = { title: "Detail pesanan" };

export default function PosOrderPage({ params }: PageProps<"/pos/orders/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="m-4 h-96 rounded-xl" />}>
      <PosOrder params={params} />
    </Suspense>
  );
}

async function PosOrder({ params }: Pick<PageProps<"/pos/orders/[id]">, "params">) {
  const actor = await requirePermission("order.view");
  const { id } = await params;
  const order = await getOrderDetail(db, actor, id).catch((error: unknown) => {
    if (error instanceof AccessError) notFound();
    throw error;
  });
  const scope = { outletId: order.outletId };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/pos/orders?outlet=${order.outletId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> Daftar pesanan
        </Link>
        <LiveRefresh topic={outletOrdersTopic(order.outletId)} />
      </div>
      <OrderDetailView
        order={order}
        receiptHref={`/pos/orders/${order.id}/receipt`}
        flags={{
          canConfirmCash: hasPermission(actor, "payment.confirm_cash", scope),
          canCancel: hasPermission(actor, "order.void", scope),
          canDecide:
            hasPermission(actor, "approval.approve", scope) &&
            order.pendingApproval?.requestedBy !== actor.id,
        }}
      />
    </main>
  );
}
