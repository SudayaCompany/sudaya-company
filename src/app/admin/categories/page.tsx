import { TagsIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader, PageSkeleton } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { hasPermission } from "@/lib/auth/policy";
import { requirePermission } from "@/lib/auth/session";
import { listCategories, resolveCatalogScope } from "@/lib/catalog/admin-ops";

import { CategoryRow, NewCategoryForm } from "./category-controls";

export const metadata: Metadata = { title: "Kategori" };

export default function CategoriesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Categories />
    </Suspense>
  );
}

async function Categories() {
  const actor = await requirePermission("product.view");
  const scope = await resolveCatalogScope(db, actor);
  const categories = await listCategories(db, actor, scope.brand.id);
  const canCreate = hasPermission(actor, "product.create", { outletId: null });
  const canEdit = hasPermission(actor, "product.edit", { outletId: null });
  const canDelete = hasPermission(actor, "product.delete", { outletId: null });

  return (
    <>
      <PageHeader
        title="Kategori"
        description={`${scope.brand.name} · Urutan menentukan posisi kategori di menu customer.`}
      />
      {canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Kategori baru</CardTitle>
            <CardDescription>Contoh: Coffee, Non Coffee, Tea, Food, Snack.</CardDescription>
          </CardHeader>
          <CardContent>
            <NewCategoryForm
              brandId={scope.brand.id}
              nextSortOrder={(categories.at(-1)?.sortOrder ?? -1) + 1}
            />
          </CardContent>
        </Card>
      ) : null}

      {categories.length === 0 ? (
        <EmptyState icon={TagsIcon} title="Belum ada kategori" description="Kategori mengelompokkan menu di halaman customer." />
      ) : (
        <Card>
          <CardContent>
            <div className="hidden gap-2 pb-2 text-xs text-muted-foreground sm:grid sm:grid-cols-[1fr_1fr_5rem_8rem_4.5rem]">
              <span>Nama</span>
              <span>Slug</span>
              <span>Urutan</span>
              <span>Aktif</span>
              <span />
            </div>
            {categories.map((category) => (
              <CategoryRow
                key={`${category.id}:${category.name}:${category.slug}:${category.sortOrder}`}
                category={category}
                canEdit={canEdit}
                canDelete={canDelete}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
