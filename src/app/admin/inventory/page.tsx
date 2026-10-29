import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  ClipboardListIcon,
  PackageIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { OutletSelect } from "@/components/inventory/outlet-select";
import { StockBadge } from "@/components/inventory/stock-badge";
import { PageHeader, PageSkeleton } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { hasPermission } from "@/lib/auth/policy";
import type { Permission } from "@/lib/auth/rbac";
import { requirePermission } from "@/lib/auth/session";
import { formatRupiah } from "@/lib/format";
import { inventoryDashboard } from "@/lib/inventory/queries";
import { formatQty } from "@/lib/inventory/units";
import { firstValues, toQuery } from "@/lib/search-params";
import { cn } from "@/lib/utils";

import { MovementList } from "./movement-list";
import { resolveInventoryOutlet } from "./scope";

export const metadata: Metadata = { title: "Inventory" };

const ACTIONS: { href: string; label: string; icon: LucideIcon; permission: Permission }[] = [
  { href: "/admin/inventory/stock-in", label: "Stok masuk", icon: ArrowDownToLineIcon, permission: "inventory.receive" },
  { href: "/admin/inventory/stock-out", label: "Stok keluar", icon: ArrowUpFromLineIcon, permission: "inventory.issue" },
  { href: "/admin/inventory/waste", label: "Catat waste", icon: Trash2Icon, permission: "inventory.issue" },
  { href: "/admin/inventory/opname", label: "Stock opname", icon: ClipboardListIcon, permission: "inventory.opname" },
];

export default function InventoryPage({ searchParams }: PageProps<"/admin/inventory">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

function Stat({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  tone?: "warning" | "danger";
}) {
  const body = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-2xl font-semibold tabular-nums",
          tone === "danger" && "text-destructive",
          tone === "warning" && "text-foreground",
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </>
  );
  const className = cn(
    "flex flex-col gap-1 rounded-xl border p-4",
    tone === "warning" && "border-warning/60 bg-warning/10",
    tone === "danger" && "border-destructive/40 bg-destructive/5",
    href && "transition-colors hover:border-foreground",
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

async function Dashboard({ searchParams }: Pick<PageProps<"/admin/inventory">, "searchParams">) {
  const actor = await requirePermission("inventory.view");
  const raw = firstValues(await searchParams);
  const { outlets, outlet } = await resolveInventoryOutlet(actor, "inventory.view", raw.outlet);
  const data = await inventoryDashboard(db, actor, outlet.id);
  const q = (extra: Record<string, string>) => toQuery({ outlet: raw.outlet, ...extra });
  const actions = ACTIONS.filter((a) => hasPermission(actor, a.permission, { outletId: outlet.id }));
  const canReverse = hasPermission(actor, "inventory.adjust", { outletId: outlet.id });
  const s = data.summary;

  return (
    <>
      <PageHeader title="Inventory" description={`${outlet.name} · data stok real time dari ledger`}>
        <OutletSelect outlets={outlets} value={outlet.id} />
      </PageHeader>

      {actions.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {actions.map((a) => (
            <Link
              key={a.href}
              href={`${a.href}${q({})}`}
              className={cn(buttonVariants({ variant: "outline" }), "h-14 justify-start gap-3 text-base")}
            >
              <a.icon className="size-5" /> {a.label}
            </Link>
          ))}
        </div>
      ) : null}

      {s.active + s.inactive === 0 ? (
        <EmptyState
          icon={PackageIcon}
          title="Belum ada item stok"
          description="Tambahkan bahan baku, kemasan, atau produk jadi di menu Item untuk mulai mencatat stok."
        />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Ringkasan stok">
            <Stat label="Item aktif" value={String(s.active)} hint={s.inactive ? `${s.inactive} nonaktif` : undefined} href={`/admin/inventory/items${q({})}`} />
            <Stat label="Stok menipis" value={String(s.low)} hint="≤ minimum stok" tone={s.low ? "warning" : undefined} href={`/admin/inventory/items${q({ level: "low" })}`} />
            <Stat label="Stok habis" value={String(s.out)} hint="Produk jadi terkait otomatis sold out" tone={s.out ? "danger" : undefined} href={`/admin/inventory/items${q({ level: "out" })}`} />
            <Stat
              label="Nilai stok"
              value={s.costed === 0 || s.stockValue === null ? "—" : formatRupiah(s.stockValue)}
              hint={
                s.costed === 0
                  ? "Belum ada harga pokok item"
                  : `${s.costed} dari ${s.active} item punya harga pokok`
              }
            />
            <Stat
              label="Waste bulan ini"
              value={String(data.waste.events)}
              hint={
                data.waste.events === 0
                  ? "Belum ada catatan waste"
                  : data.waste.value === null
                    ? "Nilai belum diketahui (tanpa harga pokok)"
                    : `${formatRupiah(data.waste.value)}${data.waste.uncosted ? ` + ${data.waste.uncosted} tanpa harga` : ""}`
              }
              href={`/admin/inventory/waste${q({})}`}
            />
            <Stat
              label="Penyesuaian bulan ini"
              value={String(data.adjustments.events)}
              hint={
                data.adjustments.events === 0
                  ? "Koreksi, reversal & opname"
                  : data.adjustments.value === null
                    ? "Nilai belum diketahui"
                    : `Selisih bersih ${formatRupiah(data.adjustments.value)}`
              }
              href={`/admin/inventory/movements${q({})}`}
            />
            <Stat
              label="Menunggu approval"
              value={String(data.pendingApprovals)}
              hint="Koreksi, reversal & opname"
              tone={data.pendingApprovals ? "warning" : undefined}
              href={`/admin/inventory/movements${q({})}#approval`}
            />
            <Stat
              label="Opname terakhir"
              value={data.lastOpname ? `${data.lastOpname.withVariance} selisih` : "—"}
              hint={
                data.lastOpname
                  ? `${data.lastOpname.counted} item dihitung${data.lastOpname.value !== null && data.lastOpname.withVariance ? ` · ${formatRupiah(data.lastOpname.value)}` : ""}`
                  : "Belum pernah opname"
              }
              href={`/admin/inventory/opname${q({})}`}
            />
          </section>

          {s.expiringSoon ? (
            <p className="rounded-lg border border-warning/60 bg-warning/10 px-3 py-2 text-sm">
              {s.expiringSoon} item ber-stok akan/sudah kedaluwarsa dalam 7 hari. Cek di menu Item.
            </p>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Perlu perhatian</CardTitle>
              </CardHeader>
              <CardContent>
                {data.attention.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Semua item aktif di atas minimum stok.</p>
                ) : (
                  <ul className="flex flex-col divide-y">
                    {data.attention.map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatQty(item.stockQty, item.unit)} · min {formatQty(item.minimumStock, item.unit)}
                          </p>
                        </div>
                        <StockBadge level={item.level} />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Mutasi terbaru</CardTitle>
                <Link href={`/admin/inventory/movements${q({})}`} className="text-sm underline underline-offset-2">
                  Semua mutasi
                </Link>
              </CardHeader>
              <CardContent>
                {data.recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada mutasi stok.</p>
                ) : (
                  <MovementList rows={data.recent} timezone={outlet.timezone} canReverse={canReverse} compact />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
