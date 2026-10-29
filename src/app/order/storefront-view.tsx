"use client";

import { CoffeeIcon, MapPinIcon, PlusIcon, UtensilsIcon } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { Brand } from "@/components/brand";
import { EmptyState } from "@/components/empty-state";
import type { Storefront, StorefrontProduct } from "@/lib/catalog/storefront";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

import { CartBar, CartProvider } from "./cart";
import { ProductSheet } from "./product-sheet";

export function StorefrontView({ storefront, table }: { storefront: Storefront; table: string | null }) {
  const [openProduct, setOpenProduct] = useState<StorefrontProduct | null>(null);
  const sections = storefront.categories
    .map((category) => ({
      category,
      products: storefront.products.filter((p) => p.categoryId === category.id),
    }))
    .filter((s) => s.products.length > 0);

  return (
    <CartProvider outlet={storefront.outlet.code}>
      <div className="flex min-h-svh flex-col bg-background">
        <header className="relative overflow-hidden bg-neutral-950 text-white">
          <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-brand/20 blur-3xl" aria-hidden />
          <div className="relative mx-auto w-full max-w-5xl px-4 pt-6 pb-8">
            <Brand tone="light" className="text-lg" />
            <h1 className="mt-6 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Mau ngopi apa hari ini?
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-400">
              <span className="inline-flex items-center gap-1">
                <MapPinIcon className="size-3.5" aria-hidden /> {storefront.outlet.name}
              </span>
              {table ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-white">
                  <UtensilsIcon className="size-3.5" aria-hidden /> Meja {table}
                </span>
              ) : null}
            </p>
          </div>
        </header>

        {sections.length === 0 ? (
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
            <EmptyState
              icon={CoffeeIcon}
              title="Menu belum tersedia"
              description="Menu outlet ini sedang disiapkan. Silakan pesan langsung ke kasir."
            />
          </main>
        ) : (
          <>
            <nav
              aria-label="Kategori menu"
              className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75"
            >
              <div className="mx-auto flex w-full max-w-5xl gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none]">
                {sections.map(({ category }) => (
                  <a
                    key={category.id}
                    href={`#kategori-${category.slug}`}
                    className="shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors hover:border-foreground"
                  >
                    {category.name}
                  </a>
                ))}
              </div>
            </nav>

            <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 pt-6 pb-32">
              {sections.map(({ category, products }) => (
                <section key={category.id} id={`kategori-${category.slug}`} className="scroll-mt-20">
                  <h2 className="mb-3 text-lg font-semibold tracking-tight">{category.name}</h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {products.map((product) => (
                      <ProductCard key={product.id} product={product} onOpen={() => setOpenProduct(product)} />
                    ))}
                  </div>
                </section>
              ))}
            </main>
          </>
        )}

        <ProductSheet product={openProduct} onOpenChange={(open) => !open && setOpenProduct(null)} />
        <CartBar />
      </div>
    </CartProvider>
  );
}

function ProductCard({ product, onOpen }: { product: StorefrontProduct; onOpen: () => void }) {
  const soldOut = !product.isAvailable;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-2xl border bg-card text-left transition-shadow hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      aria-label={`${product.name}, ${formatRupiah(product.price)}${soldOut ? ", sold out" : ""}`}
    >
      <div className="relative aspect-square bg-muted">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className={cn("object-cover transition-transform duration-300 group-hover:scale-[1.03]", soldOut && "grayscale")}
          />
        ) : (
          <CoffeeIcon className="absolute inset-0 m-auto size-10 text-muted-foreground/40" aria-hidden />
        )}
        {soldOut ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-neutral-950">Sold out</span>
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm font-medium">{product.name}</p>
        <div className="mt-auto flex min-h-8 items-center justify-between pt-1">
          <span className="text-sm font-semibold tabular-nums">{formatRupiah(product.price)}</span>
          {soldOut ? null : (
            <span className="flex size-7 items-center justify-center rounded-full bg-neutral-950 text-white transition-colors group-hover:bg-brand group-hover:text-brand-foreground">
              <PlusIcon className="size-4" aria-hidden />
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
