"use client";

import { Loader2Icon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { ConfirmAction } from "@/components/confirm-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useActionToast } from "@/hooks/use-action-toast";
import { slugify } from "@/lib/catalog/slug";

import { createCategoryAction, deleteCategoryAction, updateCategoryAction } from "./actions";

export type CategoryRowData = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
};

export function NewCategoryForm({ brandId, nextSortOrder }: { brandId: string; nextSortOrder: number }) {
  const [name, setName] = useState("");
  const { pending, run } = useActionToast();

  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () =>
            createCategoryAction({
              id: brandId,
              values: { name, slug: slugify(name), sortOrder: nextSortOrder, isActive: true },
            }),
          () => setName(""),
        );
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nama kategori, mis. Coffee"
        aria-label="Nama kategori baru"
        minLength={2}
        maxLength={60}
        required
      />
      <Button type="submit" disabled={pending || name.trim().length < 2}>
        {pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Tambah
      </Button>
    </form>
  );
}

export function CategoryRow({
  category,
  canEdit,
  canDelete,
}: {
  category: CategoryRowData;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [name, setName] = useState(category.name);
  const [slug, setSlug] = useState(category.slug);
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder));
  const { pending, run } = useActionToast();

  const dirty =
    name !== category.name || slug !== category.slug || sortOrder !== String(category.sortOrder);
  const save = (isActive = category.isActive) =>
    run(() =>
      updateCategoryAction({
        id: category.id,
        values: { name, slug, sortOrder, isActive },
      }),
    );

  return (
    <div className="grid items-center gap-2 border-b py-3 last:border-b-0 sm:grid-cols-[1fr_1fr_5rem_8rem_4.5rem]">
      <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} aria-label="Nama kategori" />
      <Input
        value={slug}
        onChange={(e) => setSlug(e.target.value.toLowerCase())}
        disabled={!canEdit}
        aria-label="Slug kategori"
        className="font-mono text-xs"
      />
      <Input
        type="number"
        min={0}
        value={sortOrder}
        onChange={(e) => setSortOrder(e.target.value)}
        disabled={!canEdit}
        aria-label="Urutan"
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch
          checked={category.isActive}
          disabled={!canEdit || pending}
          onCheckedChange={(next) => save(next)}
          aria-label={`Aktifkan ${category.name}`}
        />
        {category.productCount} produk
      </label>
      <div className="flex justify-end gap-1">
        {canEdit ? (
          <Button size="icon-sm" variant="outline" disabled={!dirty || pending} onClick={() => save()} aria-label="Simpan kategori">
            {pending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
          </Button>
        ) : null}
        {canDelete ? (
          <ConfirmAction
            trigger={
              <Button size="icon-sm" variant="ghost" disabled={pending} aria-label={`Hapus ${category.name}`}>
                <Trash2Icon className="text-destructive" />
              </Button>
            }
            title="Hapus kategori?"
            description={
              category.productCount > 0
                ? `${category.name} masih berisi ${category.productCount} produk dan tidak bisa dihapus. Pindahkan produknya dulu.`
                : `${category.name} dihapus dari menu.`
            }
            confirmLabel="Hapus"
            onConfirm={() => run(() => deleteCategoryAction(category.id))}
          />
        ) : null}
      </div>
    </div>
  );
}
