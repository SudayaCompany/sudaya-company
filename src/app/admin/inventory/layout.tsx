import { Suspense } from "react";

import { hasPermission } from "@/lib/auth/policy";
import type { Permission } from "@/lib/auth/rbac";
import { requirePermission } from "@/lib/auth/session";

import { InventoryTabs } from "./inventory-tabs";

const TABS: { href: string; label: string; permission: Permission }[] = [
  { href: "/admin/inventory", label: "Ringkasan", permission: "inventory.view" },
  { href: "/admin/inventory/items", label: "Item", permission: "inventory.view" },
  { href: "/admin/inventory/movements", label: "Mutasi", permission: "inventory.view" },
  { href: "/admin/inventory/stock-in", label: "Stok masuk", permission: "inventory.receive" },
  { href: "/admin/inventory/stock-out", label: "Stok keluar", permission: "inventory.issue" },
  { href: "/admin/inventory/waste", label: "Waste", permission: "inventory.view" },
  { href: "/admin/inventory/opname", label: "Opname", permission: "inventory.view" },
];

export default function InventoryLayout({ children }: LayoutProps<"/admin/inventory">) {
  return (
    <>
      <Suspense fallback={<div className="h-8" />}>
        <Tabs />
      </Suspense>
      {children}
    </>
  );
}

async function Tabs() {
  const user = await requirePermission("inventory.view");
  const tabs = TABS.filter((t) => hasPermission(user, t.permission)).map(({ href, label }) => ({ href, label }));
  return <InventoryTabs tabs={tabs} />;
}
