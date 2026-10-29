import { MonitorSmartphoneIcon, StoreIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Brand } from "@/components/brand";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getDefaultOutletCode, getStorefront } from "@/lib/catalog/cache";
import { firstValues } from "@/lib/search-params";

import { StorefrontView } from "../order/storefront-view";

export const metadata: Metadata = { title: "Kiosk", robots: { index: false } };

// Kiosk publik di outlet: /kiosk?outlet=SDY01. Tidak ada tautan ke area
// staff/admin dan tidak menyimpan token order (perangkat dipakai bersama).
export default function KioskPage({ searchParams }: PageProps<"/kiosk">) {
  return (
    <Suspense fallback={<KioskSkeleton />}>
      <Kiosk searchParams={searchParams} />
    </Suspense>
  );
}

async function Kiosk({ searchParams }: Pick<PageProps<"/kiosk">, "searchParams">) {
  const params = firstValues(await searchParams);
  const outletCode = params.outlet ?? (await getDefaultOutletCode());
  const storefront = outletCode ? await getStorefront(outletCode) : null;

  if (!storefront) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16">
        <Brand className="text-2xl" />
        <EmptyState
          icon={outletCode ? StoreIcon : MonitorSmartphoneIcon}
          title={outletCode ? "Outlet tidak ditemukan" : "Kiosk belum dikonfigurasi"}
          description="Hubungi staf outlet untuk menyiapkan kiosk ini."
        />
      </main>
    );
  }
  return <StorefrontView storefront={storefront} table={null} channel="kiosk" mode="kiosk" />;
}

function KioskSkeleton() {
  return (
    <div className="flex min-h-svh flex-col gap-6 p-6" aria-busy aria-label="Memuat menu">
      <Skeleton className="h-28 rounded-2xl" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="aspect-square rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
