import { CoffeeIcon, ImageOffIcon, PlusIcon, SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader, PageSkeleton } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import { hasPermission } from "@/lib/auth/policy";
import { requirePermission } from "@/lib/auth/session";
import {
  listCategories,
  listProducts,
  productListParams,
  resolveCatalogScope,
} from "@/lib/catalog/admin-ops";
import { menuImageUrl } from "@/lib/catalog/image-url";
import { formatRupiah } from "@/lib/format";
import { firstValues, toQuery } from "@/lib/search-params";

import { AvailabilitySwitch, ProductRowActions } from "./product-row-actions";

export const metadata: Metadata = { title: "Produk" };

export default function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Products searchParams={searchParams} />
    </Suspense>
  );
}

async function Products({ searchParams }: Pick<PageProps<"/admin/products">, "searchParams">) {
  const actor = await requirePermission("product.view");
  const raw = firstValues(await searchParams);
  const params = productListParams.parse(raw);
  const scope = await resolveCatalogScope(db, actor, raw.brand);
  const outlet = scope.outlets.find((o) => o.id === params.outlet) ?? scope.outlets[0] ?? null;

  const [list, categories] = await Promise.all([
    listProducts(db, actor, scope.brand.id, outlet?.id ?? null, params),
    listCategories(db, actor, scope.brand.id),
  ]);

  const canCreate = hasPermission(actor, "product.create", { outletId: null });
  const canEdit = hasPermission(actor, "product.edit", { outletId: null });
  const canDelete = hasPermission(actor, "product.delete", { outletId: null });
  const canToggleAvailability =
    outlet !== null && hasPermission(actor, "product.edit", { outletId: outlet.id });

  const filters = {
    q: params.q,
    category: params.category,
    status: params.status === "all" ? undefined : params.status,
    availability: params.availability === "all" ? undefined : params.availability,
    sort: params.sort === "name" ? undefined : params.sort,
    dir: params.dir === "asc" ? undefined : params.dir,
    outlet: params.outlet,
  };
  const hasFilters = Boolean(params.q || params.category || filters.status || filters.availability);

  return (
    <>
      <PageHeader
        title="Produk"
        description={`${scope.brand.name} · ${list.total} produk${outlet ? ` · Ketersediaan untuk ${outlet.name}` : ""}`}
      >
        {canCreate ? (
          <Link href="/admin/products/new" className={buttonVariants()}>
            <PlusIcon /> Produk baru
          </Link>
        ) : null}
      </PageHeader>

      {raw.saved ? (
        <p role="status" className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm">
          Produk tersimpan.
        </p>
      ) : null}

      <form method="get" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto_auto]">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={params.q} placeholder="Cari nama atau SKU" className="pl-8" aria-label="Cari produk" />
        </div>
        <NativeSelect name="category" defaultValue={params.category ?? ""} aria-label="Kategori" className="w-full">
          <NativeSelectOption value="">Semua kategori</NativeSelectOption>
          {categories.map((c) => (
            <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="status" defaultValue={params.status} aria-label="Status" className="w-full">
          <NativeSelectOption value="all">Semua status</NativeSelectOption>
          <NativeSelectOption value="active">Aktif</NativeSelectOption>
          <NativeSelectOption value="inactive">Nonaktif</NativeSelectOption>
        </NativeSelect>
        {outlet ? (
          <NativeSelect name="availability" defaultValue={params.availability} aria-label="Ketersediaan" className="w-full">
            <NativeSelectOption value="all">Semua ketersediaan</NativeSelectOption>
            <NativeSelectOption value="available">Tersedia</NativeSelectOption>
            <NativeSelectOption value="sold_out">Sold out</NativeSelectOption>
          </NativeSelect>
        ) : null}
        <NativeSelect name="sort" defaultValue={`${params.sort}`} aria-label="Urutkan" className="w-full">
          <NativeSelectOption value="name">Urut: Nama</NativeSelectOption>
          <NativeSelectOption value="price">Urut: Harga</NativeSelectOption>
          <NativeSelectOption value="updated">Urut: Terakhir diubah</NativeSelectOption>
        </NativeSelect>
        <div className="flex gap-2">
          <NativeSelect name="dir" defaultValue={params.dir} aria-label="Arah urutan" className="w-full">
            <NativeSelectOption value="asc">Naik</NativeSelectOption>
            <NativeSelectOption value="desc">Turun</NativeSelectOption>
          </NativeSelect>
          {scope.outlets.length > 1 ? (
            <NativeSelect name="outlet" defaultValue={outlet?.id} aria-label="Outlet" className="w-full">
              {scope.outlets.map((o) => (
                <NativeSelectOption key={o.id} value={o.id}>{o.name}</NativeSelectOption>
              ))}
            </NativeSelect>
          ) : null}
          <Button type="submit" variant="outline">Terapkan</Button>
        </div>
      </form>

      {list.rows.length === 0 ? (
        <EmptyState
          icon={CoffeeIcon}
          title={hasFilters ? "Tidak ada produk yang cocok" : "Belum ada produk"}
          description={
            hasFilters
              ? "Ubah kata kunci atau filter."
              : categories.length === 0
                ? "Buat kategori dulu, lalu tambahkan produk."
                : "Tambahkan produk pertama untuk menu customer."
          }
        />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Foto</TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead className="text-right">Harga</TableHead>
                  <TableHead>Status</TableHead>
                  {outlet ? <TableHead>Tersedia</TableHead> : null}
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((product) => {
                  const imageUrl = menuImageUrl(product.imagePath);
                  return (
                    <TableRow key={product.id}>
                      <TableCell>
                        <div className="relative size-10 overflow-hidden rounded-md bg-muted">
                          {imageUrl ? (
                            <Image src={imageUrl} alt="" fill sizes="40px" className="object-cover" />
                          ) : (
                            <ImageOffIcon className="absolute inset-0 m-auto size-4 text-muted-foreground" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{product.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {product.sku ?? "—"} · {product.slug}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">{product.categoryName}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(product.basePrice)}</TableCell>
                      <TableCell>
                        <Badge variant={product.isActive ? "secondary" : "outline"}>
                          {product.isActive ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </TableCell>
                      {outlet ? (
                        <TableCell>
                          <AvailabilitySwitch
                            productId={product.id}
                            productName={product.name}
                            outletId={outlet.id}
                            isAvailable={product.isAvailable}
                            disabled={!canToggleAvailability}
                          />
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <ProductRowActions
                          productId={product.id}
                          productName={product.name}
                          isActive={product.isActive}
                          canEdit={canEdit}
                          canDelete={canDelete}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {list.pageCount > 1 ? (
        <nav aria-label="Halaman" className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Halaman {list.page} dari {list.pageCount}
          </span>
          <div className="flex gap-2">
            {list.page > 1 ? (
              <Link
                className={buttonVariants({ variant: "outline", size: "sm" })}
                href={`/admin/products${toQuery({ ...filters, page: list.page - 1 })}`}
              >
                Sebelumnya
              </Link>
            ) : null}
            {list.page < list.pageCount ? (
              <Link
                className={buttonVariants({ variant: "outline", size: "sm" })}
                href={`/admin/products${toQuery({ ...filters, page: list.page + 1 })}`}
              >
                Berikutnya
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </>
  );
}
