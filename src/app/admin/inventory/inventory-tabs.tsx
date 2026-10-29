"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

export type InventoryTab = { href: string; label: string };

/** Sub-navigasi inventory (wrap, tanpa scroll horizontal). Membawa ?outlet=. */
export function InventoryTabs({ tabs }: { tabs: InventoryTab[] }) {
  const pathname = usePathname();
  const outlet = useSearchParams().get("outlet");
  const query = outlet ? `?outlet=${encodeURIComponent(outlet)}` : "";

  return (
    <nav aria-label="Menu inventory" className="flex flex-wrap gap-1.5">
      {tabs.map((tab) => {
        const active =
          tab.href === "/admin/inventory"
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={`${tab.href}${query}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "border-neutral-950 bg-neutral-950 text-white" : "bg-background hover:border-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
