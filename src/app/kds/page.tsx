import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Brand } from "@/components/brand";
import { LogoutButton } from "@/components/logout-button";
import { LiveRefresh } from "@/components/orders/live-refresh";
import { PageSkeleton } from "@/components/page-header";
import { db } from "@/db";
import { hasPermission } from "@/lib/auth/policy";
import { requirePermission } from "@/lib/auth/session";
import { getKdsBoard } from "@/lib/orders/engine";
import { outletOrdersTopic } from "@/lib/orders/realtime";
import { firstValues } from "@/lib/search-params";

import { resolveStaffOutlet } from "../pos/pos-outlet";
import { KdsBoard } from "./kds-board";

export const metadata: Metadata = { title: "Barista Display" };

export default function KdsPage({ searchParams }: PageProps<"/kds">) {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-4">
        <Link href="/staff" className="flex flex-col">
          <Brand className="text-lg" />
          <span className="text-xs text-muted-foreground">Barista Display</span>
        </Link>
        <LogoutButton variant="ghost" />
      </header>
      <Suspense fallback={<PageSkeleton />}>
        <Board searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Board({ searchParams }: Pick<PageProps<"/kds">, "searchParams">) {
  const actor = await requirePermission("kds.view");
  const params = firstValues(await searchParams);
  const { outlet } = await resolveStaffOutlet(actor, "kds.view", params.outlet);
  const board = await getKdsBoard(db, actor, outlet.id);
  const scope = { outletId: outlet.id };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{board.outlet.name} · Antrean FIFO berdasarkan waktu bayar</span>
        <LiveRefresh topic={outletOrdersTopic(outlet.id)} />
      </div>
      <KdsBoard
        orders={board.orders}
        canUpdate={hasPermission(actor, "order.update_status", scope)}
        canOverride={hasPermission(actor, "kds.manage", scope)}
      />
    </>
  );
}
