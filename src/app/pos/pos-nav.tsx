"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

/** Navigasi POS; mempertahankan ?outlet= saat berpindah halaman. */
export function PosNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const outlet = useSearchParams().get("outlet");

  return (
    <nav aria-label="Menu POS" className="flex gap-1 overflow-x-auto">
      {items.map((item) => {
        const active =
          item.href === "/pos" ? pathname === "/pos" : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={outlet ? `${item.href}?outlet=${outlet}` : item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "bg-white text-neutral-950" : "text-neutral-300 hover:bg-white/10 hover:text-white",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
