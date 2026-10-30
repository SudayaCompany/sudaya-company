import {
  BriefcaseIcon,
  ClipboardCheckIcon,
  MonitorIcon,
  PackageIcon,
  ScanFaceIcon,
  ShoppingBagIcon,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Brand } from "@/components/brand";
import { LogoutButton } from "@/components/logout-button";
import { PageSkeleton } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db";
import { listAccessibleOutlets } from "@/lib/auth/access";
import { roleNames } from "@/lib/auth/format";
import { hasPermission } from "@/lib/auth/policy";
import type { Permission } from "@/lib/auth/rbac";
import { STAFF_APP_PERMISSIONS } from "@/lib/auth/rbac";
import { requireAnyPermission } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Staff" };

type Shortcut = {
  label: string;
  description: string;
  icon: LucideIcon;
  permission: Permission;
  /** null = modul belum tersedia. */
  href: string | null;
};

const SHORTCUTS: Shortcut[] = [
  {
    label: "Absensi",
    description: "Check-in & check-out dengan wajah + lokasi",
    icon: ClipboardCheckIcon,
    permission: "attendance.checkin",
    href: "/staff/attendance",
  },
  {
    label: "Tugas luar",
    description: "Ajukan tugas di luar outlet",
    icon: BriefcaseIcon,
    permission: "attendance.checkin",
    href: "/staff/outside-duty",
  },
  {
    label: "Registrasi wajah",
    description: "Persetujuan & status data wajah",
    icon: ScanFaceIcon,
    permission: "attendance.checkin",
    href: "/staff/face-enrollment",
  },
  {
    label: "Order / POS",
    description: "Input pesanan customer & pembayaran",
    icon: ShoppingBagIcon,
    permission: "order.create",
    href: "/pos",
  },
  {
    label: "Barista Display",
    description: "Antrean produksi New → Ready",
    icon: MonitorIcon,
    permission: "kds.view",
    href: "/kds",
  },
  {
    label: "Stok",
    description: "Cek stok, catat stok keluar & waste",
    icon: PackageIcon,
    permission: "inventory.view",
    href: "/admin/inventory",
  },
];

export default function StaffPage() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between">
        <Brand className="text-lg" />
        <LogoutButton variant="ghost" />
      </header>
      <Suspense fallback={<PageSkeleton />}>
        <StaffHome />
      </Suspense>
    </div>
  );
}

async function StaffHome() {
  const user = await requireAnyPermission(STAFF_APP_PERMISSIONS);
  const outlets = await listAccessibleOutlets(db, user);
  const shortcuts = SHORTCUTS.filter((s) => hasPermission(user, s.permission));

  return (
    <>
      <section className="flex flex-col gap-2 rounded-xl bg-neutral-950 p-5 text-white">
        <p className="text-sm text-neutral-400">Selamat bertugas,</p>
        <p className="text-xl font-semibold">{user.fullName}</p>
        <div className="flex flex-wrap gap-1.5">
          {roleNames(user.grants).map((role) => (
            <Badge key={role} className="bg-brand text-brand-foreground">
              {role}
            </Badge>
          ))}
        </div>
        <p className="text-sm text-neutral-300">
          {outlets.length === 0
            ? "Belum ada outlet aktif"
            : outlets.map((o) => o.name).join(", ")}
        </p>
      </section>

      <section className="grid gap-3">
        {shortcuts.map((shortcut) => {
          const content = (
            <>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <shortcut.icon className="size-5" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{shortcut.label}</span>
                <span className="text-xs text-muted-foreground">{shortcut.description}</span>
              </span>
              {shortcut.href ? null : <Badge variant="outline">Segera hadir</Badge>}
            </>
          );
          const className = cn(
            "flex items-center gap-3 rounded-xl border p-4",
            shortcut.href ? "transition-colors hover:border-brand" : "opacity-60",
          );
          return shortcut.href ? (
            <Link key={shortcut.label} href={shortcut.href} className={className}>
              {content}
            </Link>
          ) : (
            <div key={shortcut.label} className={className} aria-disabled>
              {content}
            </div>
          );
        })}
      </section>
    </>
  );
}
