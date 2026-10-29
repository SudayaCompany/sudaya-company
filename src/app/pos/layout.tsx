import Link from "next/link";
import { Suspense } from "react";

import { Brand } from "@/components/brand";
import { LogoutButton } from "@/components/logout-button";
import { hasPermission } from "@/lib/auth/policy";
import { requireAuth } from "@/lib/auth/session";

import { PosNav } from "./pos-nav";

export default function PosLayout({ children }: LayoutProps<"/pos">) {
  return (
    <div className="flex min-h-svh flex-1 flex-col bg-muted/30">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 bg-neutral-950 px-4 text-white print:hidden">
        <Link href="/pos" className="flex shrink-0 items-baseline gap-2">
          <Brand tone="light" className="text-base" />
          <span className="hidden text-xs text-neutral-400 sm:inline">POS</span>
        </Link>
        <Suspense fallback={<div className="flex-1" />}>
          <PosHeader />
        </Suspense>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}

async function PosHeader() {
  const user = await requireAuth();
  const items = [
    { href: "/pos", label: "Kasir" },
    { href: "/pos/orders", label: "Pesanan" },
    ...(hasPermission(user, "kds.view") ? [{ href: "/kds", label: "KDS" }] : []),
    { href: "/staff", label: "Staff" },
  ];
  return (
    <>
      <div className="min-w-0 flex-1">
        <PosNav items={items} />
      </div>
      <span className="hidden text-sm text-neutral-300 md:inline">{user.fullName}</span>
      <LogoutButton variant="ghost" />
    </>
  );
}
