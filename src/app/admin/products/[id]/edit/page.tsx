import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/page-header";
import { db } from "@/db";
import { AccessError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/session";
import { getProductForEdit } from "@/lib/catalog/admin-ops";
import { menuImageUrl } from "@/lib/catalog/image-url";

import { productFormOptions } from "../../form-data";
import { ProductForm } from "../../product-form";

export const metadata: Metadata = { title: "Edit produk" };

export default function EditProductPage({ params }: PageProps<"/admin/products/[id]/edit">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditProduct params={params} />
    </Suspense>
  );
}

async function EditProduct({ params }: Pick<PageProps<"/admin/products/[id]/edit">, "params">) {
  const actor = await requirePermission("product.edit", { outletId: null });
  const { id } = await params;

  const product = await getProductForEdit(db, actor, id).catch((error: unknown) => {
    // Produk company lain / terhapus / id tidak valid → 404, tanpa bocor info.
    if (error instanceof AccessError) notFound();
    throw error;
  });
  const options = await productFormOptions(actor, product.brandId);

  return (
    <>
      <PageHeader title={`Edit ${product.name}`} description="Perubahan harga tercatat di audit log." />
      <ProductForm
        brandId={product.brandId}
        categories={options.categories}
        modifierGroups={options.modifierGroups}
        defaults={{
          id: product.id,
          name: product.name,
          slug: product.slug,
          sku: product.sku ?? "",
          categoryId: product.categoryId,
          description: product.description ?? "",
          basePrice: product.basePrice,
          isActive: product.isActive,
          modifierGroupIds: product.modifierGroupIds,
          imageUrl: menuImageUrl(product.imagePath),
        }}
      />
    </>
  );
}
