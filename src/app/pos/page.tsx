import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { hasPermission } from "@/lib/auth/policy";
import { requirePermission } from "@/lib/auth/session";
import { loadStorefront } from "@/lib/catalog/storefront";
import { firstValues } from "@/lib/search-params";

import { resolveStaffOutlet } from "./pos-outlet";
import { PosTerminal } from "./pos-terminal";

export const metadata: Metadata = { title: "POS" };

export default function PosPage({ searchParams }: PageProps<"/pos">) {
  return (
    <Suspense fallback={<PosSkeleton />}>
      <Pos searchParams={searchParams} />
    </Suspense>
  );
}

async function Pos({ searchParams }: Pick<PageProps<"/pos">, "searchParams">) {
  const actor = await requirePermission("order.create");
  const params = firstValues(await searchParams);
  const { outlets, outlet } = await resolveStaffOutlet(actor, "order.create", params.outlet);
  // Data langsung dari DB (tanpa cache) agar status sold out selalu terbaru.
  const storefront = await loadStorefront(db, outlet.code);

  return (
    <PosTerminal
      outlet={{ id: outlet.id, name: outlet.name }}
      outlets={outlets.map((o) => ({ id: o.id, name: o.name }))}
      categories={storefront?.categories ?? []}
      products={storefront?.products ?? []}
      canConfirmCash={hasPermission(actor, "payment.confirm_cash", { outletId: outlet.id })}
    />
  );
}

function PosSkeleton() {
  return (
    <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[1fr_24rem]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <Skeleton className="hidden h-[70svh] rounded-xl lg:block" />
    </div>
  );
}
