import { ClipboardListIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { OutletSelect } from "@/components/inventory/outlet-select";
import { PageHeader, PageSkeleton } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { hasPermission } from "@/lib/auth/policy";
import { requirePermission } from "@/lib/auth/session";
import { listItems, listOpnames } from "@/lib/inventory/queries";
import { firstValues } from "@/lib/search-params";

import { resolveInventoryOutlet } from "../scope";

import { CreateOpname } from "./create-opname";
import { OpnameStatusBadge } from "./opname-status";

export const metadata: Metadata = { title: "Stock opname" };

export default function OpnamePage({ searchParams }: PageProps<"/admin/inventory/opname">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Opnames searchParams={searchParams} />
    </Suspense>
  );
}

async function Opnames({ searchParams }: Pick<PageProps<"/admin/inventory/opname">, "searchParams">) {
  const actor = await requirePermission("inventory.view");
  const raw = firstValues(await searchParams);
  const { outlets, outlet } = await resolveInventoryOutlet(actor, "inventory.view", raw.outlet);
  const canCreate = hasPermission(actor, "inventory.opname", { outletId: outlet.id });
  const [list, items] = await Promise.all([
    listOpnames(db, actor, outlet.id),
    canCreate ? listItems(db, actor, outlet.id, { status: "active", page: 1 }) : Promise.resolve(null),
  ]);
  const open = list.rows.find((r) => r.status === "draft" || r.status === "submitted");
  const time = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: outlet.timezone });

  return (
    <>
      <PageHeader title="Stock opname" description={`${outlet.name} · hitung fisik → selisih → approval → posting`}>
        <OutletSelect outlets={outlets} value={outlet.id} />
      </PageHeader>

      {canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Sesi baru</CardTitle>
          </CardHeader>
          <CardContent>
            {open ? (
              <p className="text-sm">
                Masih ada sesi yang belum selesai.{" "}
                <Link href={`/admin/inventory/opname/${open.id}`} className="font-medium underline underline-offset-2">
                  Lanjutkan sesi {time.format(open.snapshotAt)}
                </Link>
              </p>
            ) : items && items.total === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada item aktif untuk dihitung.</p>
            ) : (
              <CreateOpname outletId={outlet.id} categories={items?.categories ?? []} />
            )}
          </CardContent>
        </Card>
      ) : null}

      {list.rows.length === 0 ? (
        <EmptyState icon={ClipboardListIcon} title="Belum ada stock opname" description="Riwayat sesi opname muncul di sini." />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/admin/inventory/opname/${r.id}`}
                className="flex flex-col gap-1 rounded-xl border p-3 transition-colors hover:border-foreground sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {time.format(r.snapshotAt)} <OpnameStatusBadge status={r.status} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.createdByName ?? "—"}
                    {r.notes ? ` · ${r.notes}` : ""}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {r.counted}/{r.items} dihitung · {r.withVariance} selisih
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
