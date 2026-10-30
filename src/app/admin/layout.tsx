import {
  BriefcaseIcon,
  ClockIcon,
  CoffeeIcon,
  IdCardIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  PackageIcon,
  ReceiptTextIcon,
  ScrollTextIcon,
  SlidersHorizontalIcon,
  TagsIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { Brand } from "@/components/brand";
import { LogoutButton } from "@/components/logout-button";
import { Skeleton } from "@/components/ui/skeleton";
import { roleNames } from "@/lib/auth/format";
import { ROUTE_ACCESS, hasAnyPermission } from "@/lib/auth/policy";
import { requireAuth } from "@/lib/auth/session";

import { NavLinks, type NavItem } from "./nav-links";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: <LayoutDashboardIcon /> },
  { href: "/admin/orders", label: "Order", icon: <ReceiptTextIcon /> },
  { href: "/admin/inventory", label: "Inventory", icon: <PackageIcon /> },
  { href: "/admin/attendance", label: "Absensi", icon: <ClockIcon /> },
  { href: "/admin/outside-duty", label: "Tugas luar", icon: <BriefcaseIcon /> },
  { href: "/admin/employees", label: "Karyawan", icon: <IdCardIcon /> },
  { href: "/admin/products", label: "Produk", icon: <CoffeeIcon /> },
  { href: "/admin/categories", label: "Kategori", icon: <TagsIcon /> },
  { href: "/admin/modifiers", label: "Modifier", icon: <SlidersHorizontalIcon /> },
  { href: "/admin/users", label: "Pengguna", icon: <UsersIcon /> },
  { href: "/admin/roles", label: "Role & Permission", icon: <KeyRoundIcon /> },
  { href: "/admin/audit", label: "Audit Log", icon: <ScrollTextIcon /> },
] as const satisfies readonly (NavItem & { href: keyof typeof ROUTE_ACCESS })[];

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-svh flex-1 flex-col md:flex-row">
      <aside className="flex flex-col gap-4 border-b bg-muted/30 p-4 md:sticky md:top-0 md:h-svh md:w-64 md:shrink-0 md:border-r md:border-b-0">
        <Link href="/admin" className="flex flex-col">
          <Brand className="text-lg" />
          <span className="text-xs text-muted-foreground">Sudaya Admin</span>
        </Link>
        <Suspense fallback={<SidebarSkeleton />}>
          <AdminSidebar />
        </Suspense>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
}

async function AdminSidebar() {
  const user = await requireAuth();
  const items = NAV.filter((item) => hasAnyPermission(user, ROUTE_ACCESS[item.href]));

  return (
    <>
      <NavLinks items={items} />
      <div className="mt-auto hidden flex-col gap-3 border-t pt-4 md:flex">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {roleNames(user.grants).join(", ") || "Tanpa role"}
          </p>
        </div>
        <LogoutButton />
      </div>
    </>
  );
}

function SidebarSkeleton() {
  return (
    <div className="flex gap-2 md:flex-col">
      <Skeleton className="h-9 w-28 md:w-full" />
      <Skeleton className="h-9 w-28 md:w-full" />
      <Skeleton className="h-9 w-28 md:w-full" />
    </div>
  );
}
