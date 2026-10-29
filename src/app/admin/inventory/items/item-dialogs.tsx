"use client";

import { LinkIcon, Loader2Icon, PencilIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { useActionToast } from "@/hooks/use-action-toast";
import {
  createItemAction,
  setItemProductsAction,
  setOpeningBalanceAction,
  updateItemAction,
} from "@/lib/inventory/actions";
import { ITEM_KIND_LABELS, ITEM_KINDS, type ItemKind } from "@/lib/inventory/schemas";
import { UNITS, UNIT_CODES, isCountUnit, qtyFromDb, qtyToString, type UnitCode } from "@/lib/inventory/units";

export type EditableItem = {
  id: string;
  sku: string;
  name: string;
  kind: ItemKind;
  category: string | null;
  unit: string;
  minimumStock: string;
  purchasePrice: string | null;
  expiryDate: string | null;
  isActive: boolean;
};

const field = "flex flex-col gap-1.5";
const plain = (value: string | null) => (value === null ? "" : qtyToString(qtyFromDb(value)));
const plainCost = (value: string | null) => (value === null ? "" : String(Number(value)));

/** Buat / ubah item master. Satuan & SKU dikunci setelah item dibuat. */
export function ItemDialog({
  outletId,
  categories,
  item,
}: {
  outletId: string;
  categories: string[];
  item?: EditableItem;
}) {
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState<UnitCode>((item?.unit as UnitCode) ?? "g");
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const { pending, run } = useActionToast();
  const editing = Boolean(item);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim() || undefined;
    const common = {
      name: text("name"),
      kind: text("kind"),
      category: text("category"),
      minimumStock: text("minimumStock"),
      purchasePrice: text("purchasePrice"),
      expiryDate: text("expiryDate"),
    };
    run(
      () =>
        item
          ? updateItemAction({ itemId: item.id, ...common, isActive })
          : createItemAction({ outletId, sku: text("sku"), unit, openingStock: text("openingStock"), ...common }),
      () => setOpen(false),
    );
  }

  return (
    <>
      {item ? (
        <Button variant="ghost" size="xs" onClick={() => setOpen(true)} aria-label={`Ubah ${item.name}`}>
          <PencilIcon /> Ubah
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <PlusIcon /> Item baru
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{editing ? `Ubah ${item!.name}` : "Item stok baru"}</DialogTitle>
              <DialogDescription>
                {editing
                  ? "Saldo stok tidak bisa diubah di sini — gunakan stok masuk/keluar, koreksi, atau opname."
                  : "Satuan dasar tidak bisa diubah setelah item dibuat."}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className={field}>
                <Label htmlFor="sku">SKU</Label>
                {editing ? (
                  <Input id="sku" value={item!.sku} disabled className="font-mono" />
                ) : (
                  <Input id="sku" name="sku" required maxLength={32} className="font-mono uppercase" placeholder="mis. MILK-FRESH" />
                )}
              </div>
              <div className={field}>
                <Label htmlFor="name">Nama</Label>
                <Input id="name" name="name" required minLength={2} maxLength={80} defaultValue={item?.name} />
              </div>
              <div className={field}>
                <Label htmlFor="kind">Jenis</Label>
                <NativeSelect id="kind" name="kind" defaultValue={item?.kind ?? "raw_material"} className="w-full">
                  {ITEM_KINDS.map((k) => (
                    <NativeSelectOption key={k} value={k}>
                      {ITEM_KIND_LABELS[k]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className={field}>
                <Label htmlFor="category">Kategori</Label>
                <Input id="category" name="category" list="inventory-categories" maxLength={40} defaultValue={item?.category ?? ""} placeholder="mis. Susu, Kopi, Cup" />
                <datalist id="inventory-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className={field}>
                <Label htmlFor="unit">Satuan dasar</Label>
                {editing ? (
                  <Input id="unit" value={item!.unit} disabled />
                ) : (
                  <NativeSelect id="unit" value={unit} onChange={(e) => setUnit(e.target.value as UnitCode)} className="w-full">
                    {UNIT_CODES.map((u) => (
                      <NativeSelectOption key={u} value={u}>
                        {UNITS[u].label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </div>
              <div className={field}>
                <Label htmlFor="minimumStock">Minimum stok ({item?.unit ?? unit})</Label>
                <Input
                  id="minimumStock"
                  name="minimumStock"
                  inputMode="decimal"
                  defaultValue={plain(item?.minimumStock ?? null)}
                  placeholder="0"
                />
              </div>
              <div className={field}>
                <Label htmlFor="purchasePrice">Harga pokok per {item?.unit ?? unit} (Rp)</Label>
                <Input
                  id="purchasePrice"
                  name="purchasePrice"
                  inputMode="decimal"
                  defaultValue={plainCost(item?.purchasePrice ?? null)}
                  placeholder="Opsional"
                />
              </div>
              <div className={field}>
                <Label htmlFor="expiryDate">Kedaluwarsa terdekat</Label>
                <Input id="expiryDate" name="expiryDate" type="date" defaultValue={item?.expiryDate ?? ""} />
              </div>
              {editing ? null : (
                <div className={field}>
                  <Label htmlFor="openingStock">Stok awal ({unit})</Label>
                  <Input
                    id="openingStock"
                    name="openingStock"
                    inputMode={isCountUnit(unit) ? "numeric" : "decimal"}
                    placeholder="0"
                  />
                </div>
              )}
            </div>

            {editing ? (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={isActive} onCheckedChange={setIsActive} /> Item aktif
              </label>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2Icon className="animate-spin" /> : null} Simpan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export type ProductOption = {
  id: string;
  name: string;
  linkedItemId: string | null;
  linkedItemName: string | null;
};

/** Hubungkan produk menu ke item produk jadi → sold out otomatis saat stok 0. */
export function LinkProductsDialog({
  item,
  products,
}: {
  item: { id: string; name: string };
  products: ProductOption[];
}) {
  const initial = products.filter((p) => p.linkedItemId === item.id).map((p) => p.id);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(initial);
  const { pending, run } = useActionToast();

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => {
          setSelected(initial);
          setOpen(true);
        }}
      >
        <LinkIcon /> Menu
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Menu untuk {item.name}</DialogTitle>
            <DialogDescription>
              Produk terpilih otomatis sold out saat stok item ini 0, dan stok berkurang saat order dibayar.
              Status sold out manual di menu tidak berubah.
            </DialogDescription>
          </DialogHeader>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada produk menu untuk brand outlet ini.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {products.map((p) => {
                const checked = selected.includes(p.id);
                const elsewhere = p.linkedItemId && p.linkedItemId !== item.id;
                return (
                  <li key={p.id}>
                    <label className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          setSelected((current) => (next ? [...current, p.id] : current.filter((id) => id !== p.id)))
                        }
                      />
                      <span className="flex-1 text-sm">{p.name}</span>
                      {elsewhere ? (
                        <span className="text-xs text-muted-foreground">terhubung ke {p.linkedItemName}</span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button
              disabled={pending}
              onClick={() => run(() => setItemProductsAction({ itemId: item.id, productIds: selected }), () => setOpen(false))}
            >
              {pending ? <Loader2Icon className="animate-spin" /> : null} Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Saldo awal untuk item yang belum pernah punya mutasi. */
export function OpeningBalanceDialog({ item }: { item: { id: string; name: string; unit: string } }) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const { pending, run } = useActionToast();
  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
        <PlusIcon /> Saldo awal
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Saldo awal {item.name}</DialogTitle>
            <DialogDescription>
              Hanya bisa sekali, sebelum ada mutasi lain. Perubahan berikutnya lewat stok masuk/keluar atau koreksi.
            </DialogDescription>
          </DialogHeader>
          <div className={field}>
            <Label htmlFor={`opening-${item.id}`}>Jumlah ({item.unit})</Label>
            <Input id={`opening-${item.id}`} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button
              disabled={pending || !quantity.trim()}
              onClick={() => run(() => setOpeningBalanceAction({ itemId: item.id, quantity }), () => setOpen(false))}
            >
              {pending ? <Loader2Icon className="animate-spin" /> : null} Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
