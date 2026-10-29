import {
  BoxesIcon,
  ClipboardCheckIcon,
  ReceiptTextIcon,
  StoreIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { LogoutButton } from "@/components/logout-button";
import { PageHeader, PageSkeleton } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import { listAccessibleOutlets } from "@/lib/auth/access";
import { scopeLabel } from "@/lib/auth/format";
import { requirePermission } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Dashboard" };

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const user = await requirePermission("dashboard.view");
  const outlets = await listAccessibleOutlets(db, user);
  const outletNames = new Map(outlets.map((o) => [o.id, o.name]));
  // Belum ada pemilih outlet; outlet pertama yang bisa diakses jadi outlet aktif.
  const activeOutlet = outlets[0] ?? null;

  return (
    <>
      <PageHeader
        title={`Halo, ${user.fullName}`}
        description={`${user.company.name} · Dashboard operasional`}
      >
        <div className="md:hidden">
          <LogoutButton />
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Akun</CardTitle>
            <CardDescription>{user.email ?? "—"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <dl className="grid grid-cols-[7rem_1fr] gap-y-2">
              <dt className="text-muted-foreground">Company</dt>
              <dd>{user.company.name}</dd>
              <dt className="text-muted-foreground">Role</dt>
              <dd className="flex flex-wrap gap-1.5">
                {user.grants.map((grant) => (
                  <Badge key={grant.userRoleId} variant="secondary">
                    {grant.roleName} · {scopeLabel(grant.outletId, outletNames)}
                  </Badge>
                ))}
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <StoreIcon className="size-4" aria-hidden /> Outlet aktif
            </CardTitle>
            <CardDescription>
              {outlets.length > 1
                ? `${outlets.length} outlet dapat diakses`
                : "Outlet yang dapat diakses"}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {activeOutlet ? (
              <dl className="grid grid-cols-[7rem_1fr] gap-y-2">
                <dt className="text-muted-foreground">Brand</dt>
                <dd>{activeOutlet.brandName}</dd>
                <dt className="text-muted-foreground">Outlet</dt>
                <dd>{activeOutlet.name}</dd>
                <dt className="text-muted-foreground">Kode</dt>
                <dd className="font-mono text-xs">{activeOutlet.code}</dd>
              </dl>
            ) : (
              <p className="text-muted-foreground">Belum ada outlet aktif.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <EmptyState
          icon={ReceiptTextIcon}
          title="Penjualan"
          description="Belum ada data. Angka penjualan muncul setelah modul POS & order aktif."
        />
        <EmptyState
          icon={BoxesIcon}
          title="Stok"
          description="Belum ada data. Status stok muncul setelah modul inventory aktif."
        />
        <EmptyState
          icon={ClipboardCheckIcon}
          title="Absensi"
          description="Belum ada data. Kehadiran muncul setelah modul absensi aktif."
        />
      </div>
    </>
  );
}
