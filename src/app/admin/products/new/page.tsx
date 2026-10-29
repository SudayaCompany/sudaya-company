import { TagsIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader, PageSkeleton } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { resolveCatalogScope } from "@/lib/catalog/admin-ops";

import { productFormOptions } from "../form-data";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Produk baru" };

export default function NewProductPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewProduct />
    </Suspense>
  );
}

async function NewProduct() {
  // Data master menu berlaku untuk semua outlet → wajib company-wide.
  const actor = await requirePermission("product.create", { outletId: null });
  const scope = await resolveCatalogScope(db, actor);
  const options = await productFormOptions(actor, scope.brand.id);

  return (
    <>
      <PageHeader title="Produk baru" description={scope.brand.name} />
      {options.categories.length === 0 ? (
        <div className="flex flex-col items-center gap-4">
          <EmptyState
            icon={TagsIcon}
            title="Belum ada kategori"
            description="Setiap produk wajib masuk satu kategori."
            className="w-full"
          />
          <Link href="/admin/categories" className={buttonVariants()}>
            Buat kategori
          </Link>
        </div>
      ) : (
        <ProductForm
          brandId={scope.brand.id}
          categories={options.categories}
          modifierGroups={options.modifierGroups}
          defaults={{
            name: "",
            slug: "",
            sku: "",
            categoryId: options.categories[0].id,
            description: "",
            basePrice: 0,
            isActive: true,
            modifierGroupIds: [],
            imageUrl: null,
          }}
        />
      )}
    </>
  );
}
