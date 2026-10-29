import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { LiveRefresh } from "@/components/orders/live-refresh";
import { OrderDetailView } from "@/components/orders/order-detail";
import { PageSkeleton } from "@/components/page-header";
import { db } from "@/db";
import { AccessError } from "@/lib/auth/errors";
import { hasPermission } from "@/lib/auth/policy";
import { requirePermission } from "@/lib/auth/session";
import { getOrderDetail } from "@/lib/orders/engine";
import { outletOrdersTopic } from "@/lib/orders/realtime";

export const metadata: Metadata = { title: "Detail order" };

export default function AdminOrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AdminOrder params={params} />
    </Suspense>
  );
}

async function AdminOrder({ params }: Pick<PageProps<"/admin/orders/[id]">, "params">) {
  const actor = await requirePermission("order.view");
  const { id } = await params;
  const order = await getOrderDetail(db, actor, id).catch((error: unknown) => {
    if (error instanceof AccessError) notFound();
    throw error;
  });
  const scope = { outletId: order.outletId };

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <Link href="/admin/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> Semua order
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
    </>
  );
}
