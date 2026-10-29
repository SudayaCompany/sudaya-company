import { InboxIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Brand } from "@/components/brand";
import { EmptyState } from "@/components/empty-state";
import { LogoutButton } from "@/components/logout-button";
import { PageSkeleton } from "@/components/page-header";
import { db } from "@/db";
import { listAccessibleOutlets } from "@/lib/auth/access";
import { requirePermission } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Barista Display" };

const COLUMNS = ["New", "Preparing", "Ready", "Completed"] as const;

export default function KdsPage() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-4">
        <Link href="/staff" className="flex flex-col">
          <Brand className="text-lg" />
          <span className="text-xs text-muted-foreground">Barista Display</span>
        </Link>
        <LogoutButton variant="ghost" />
      </header>
      <Suspense fallback={<PageSkeleton />}>
        <Board />
      </Suspense>
    </div>
  );
}

async function Board() {
  const user = await requirePermission("kds.view");
  const [outlet] = await listAccessibleOutlets(db, user);

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {outlet ? outlet.name : "Belum ada outlet aktif"} · Antrean FIFO berdasarkan waktu bayar
      </p>
      <div className="grid flex-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((column) => (
          <section key={column} className="flex flex-col gap-3 rounded-xl bg-muted/40 p-3">
            <h2 className="text-sm font-semibold tracking-wide uppercase">{column}</h2>
            <EmptyState
              icon={InboxIcon}
              title="Belum ada pesanan"
              description="Antrean realtime aktif setelah modul order dibangun."
              className="bg-background"
            />
          </section>
        ))}
      </div>
    </>
  );
}
