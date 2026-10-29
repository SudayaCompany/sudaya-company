import { QrCodeIcon, StoreIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Brand } from "@/components/brand";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getDefaultOutletCode, getStorefront } from "@/lib/catalog/cache";
import { firstValues } from "@/lib/search-params";

import { StorefrontView } from "./storefront-view";

export const metadata: Metadata = { title: "Menu" };

const TABLE_PATTERN = /^[A-Za-z0-9-]{1,10}$/;

// Publik: guest boleh melihat menu tanpa login (PRD §32).
export default function OrderPage({ searchParams }: PageProps<"/order">) {
  return (
    <Suspense fallback={<CatalogSkeleton />}>
      <Storefront searchParams={searchParams} />
    </Suspense>
  );
}

async function Storefront({ searchParams }: Pick<PageProps<"/order">, "searchParams">) {
  // QR meja: /order?outlet=SDY01&table=T03 (PRD §110).
  const params = firstValues(await searchParams);
  const table = params.table && TABLE_PATTERN.test(params.table) ? params.table : null;
  const outletCode = params.outlet ?? (await getDefaultOutletCode());

  if (!outletCode) {
    return (
      <Notice
        icon={QrCodeIcon}
        title="Scan QR di outlet"
        description="Pindai kode QR di meja atau kasir Sudaya Coffee untuk melihat menu."
      />
    );
  }

  const storefront = await getStorefront(outletCode);
  if (!storefront) {
    return (
      <Notice
        icon={StoreIcon}
        title="Outlet tidak ditemukan"
        description="Kode QR tidak dikenali atau outlet sedang tutup. Silakan tanya kasir."
      />
    );
  }

  return <StorefrontView storefront={storefront} table={table} />;
}

function Notice(props: React.ComponentProps<typeof EmptyState>) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16">
      <Brand className="text-xl" />
      <EmptyState {...props} />
    </main>
  );
}

function CatalogSkeleton() {
  return (
    <div className="flex min-h-svh flex-col" aria-busy aria-label="Memuat menu">
      <div className="bg-neutral-950 px-4 pt-6 pb-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <Skeleton className="h-6 w-36 bg-white/10" />
          <Skeleton className="h-9 w-72 bg-white/10" />
          <Skeleton className="h-4 w-44 bg-white/10" />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-5xl gap-2 px-4 py-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-3 px-4 pt-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="aspect-square rounded-2xl" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
