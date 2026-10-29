"use client";

import { CoffeeIcon, Loader2Icon, MinusIcon, PlusIcon } from "lucide-react";
import Image from "next/image";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  MAX_LINE_QUANTITY,
  defaultSelection,
  priceSelection,
  selectionLimits,
  type PricingGroup,
} from "@/lib/catalog/pricing";
import type { StorefrontProduct } from "@/lib/catalog/storefront";
import { formatPriceDelta, formatRupiah } from "@/lib/format";

import { quoteCartAction } from "./actions";
import { useCart } from "./cart";

const NONE = "__none__";

export function ProductSheet({
  product,
  onOpenChange,
}: {
  product: StorefrontProduct | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={product !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92svh] w-full max-w-lg gap-0 overflow-hidden rounded-t-2xl p-0"
      >
        {product ? (
          <ProductDetail key={product.id} product={product} onDone={() => onOpenChange(false)} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ProductDetail({ product, onDone }: { product: StorefrontProduct; onDone: () => void }) {
  const cart = useCart();
  const [selected, setSelected] = useState<string[]>(() =>
    defaultSelection(product, new Set(product.defaultModifierIds)),
  );
  const [quantity, setQuantity] = useState(1);
  const [adding, startAdding] = useTransition();

  // Harga di sini hanya tampilan; harga sah dihitung ulang server saat ditambahkan.
  const priced = priceSelection(product, selected);

  function setGroupSelection(group: PricingGroup, ids: string[]) {
    const groupIds = new Set(group.modifiers.map((m) => m.id));
    setSelected((current) => [...current.filter((id) => !groupIds.has(id)), ...ids]);
  }

  function add() {
    const line = { productId: product.id, modifierIds: selected, quantity };
    startAdding(async () => {
      const quote = await quoteCartAction({ outlet: cart.outlet, lines: [line] });
      const result = quote.ok ? quote.lines[0] : null;
      if (!result?.ok) {
        toast.error(result ? result.error : quote.ok ? "Gagal menambahkan." : quote.error);
        return;
      }
      cart.add(line);
      toast.success(`${product.name} ditambahkan.`);
      onDone();
    });
  }

  return (
    <div className="flex max-h-[92svh] flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="relative aspect-4/3 bg-muted">
          {product.imageUrl ? (
            <Image src={product.imageUrl} alt={product.name} fill sizes="(max-width: 640px) 100vw, 512px" className="object-cover" />
          ) : (
            <CoffeeIcon className="absolute inset-0 m-auto size-12 text-muted-foreground/50" aria-hidden />
          )}
        </div>
        <div className="flex flex-col gap-1 p-4">
          <SheetTitle className="text-xl">{product.name}</SheetTitle>
          {product.description ? (
            <SheetDescription>{product.description}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">Detail produk</SheetDescription>
          )}
          <p className="mt-1 font-semibold tabular-nums">{formatRupiah(product.price)}</p>
          {!product.isAvailable ? <Badge variant="destructive" className="mt-1 w-fit">Sold out</Badge> : null}
        </div>

        {product.groups.map((group) => (
          <ModifierGroupField
            key={group.id}
            group={group}
            selected={selected}
            disabled={!product.isAvailable}
            onChange={(ids) => setGroupSelection(group, ids)}
          />
        ))}
      </div>

      <SheetFooter className="flex-row items-center gap-3 border-t bg-background p-4">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" aria-label="Kurangi jumlah" disabled={!product.isAvailable || quantity <= 1} onClick={() => setQuantity((q) => q - 1)}>
            <MinusIcon />
          </Button>
          <span className="w-6 text-center tabular-nums" aria-live="polite">{quantity}</span>
          <Button
            size="icon"
            variant="outline"
            aria-label="Tambah jumlah"
            disabled={!product.isAvailable || quantity >= MAX_LINE_QUANTITY}
            onClick={() => setQuantity((q) => q + 1)}
          >
            <PlusIcon />
          </Button>
        </div>
        <Button size="lg" className="h-11 flex-1" disabled={!priced.ok || adding} onClick={add}>
          {adding ? <Loader2Icon className="animate-spin" /> : null}
          {!product.isAvailable
            ? "Sold out"
            : priced.ok
              ? `Tambah · ${formatRupiah(priced.unitPrice * quantity)}`
              : priced.error}
        </Button>
      </SheetFooter>
    </div>
  );
}

function ModifierGroupField({
  group,
  selected,
  disabled,
  onChange,
}: {
  group: PricingGroup;
  selected: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const { min, max } = selectionLimits(group);
  const picked = group.modifiers.filter((m) => selected.includes(m.id)).map((m) => m.id);
  const label = min > 0 ? "Wajib" : "Opsional";
  const hint = group.selection === "single" ? "Pilih 1" : min > 0 ? `Pilih ${min}–${max}` : `Maks ${max}`;

  return (
    <fieldset className="border-t px-4 py-3">
      <legend className="sr-only">{group.name}</legend>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">{group.name}</span>
        <span className="text-xs text-muted-foreground">
          <Badge variant={min > 0 ? "default" : "outline"} className="mr-1.5">{label}</Badge>
          {hint}
        </span>
      </div>

      {group.selection === "single" ? (
        <RadioGroup
          value={picked[0] ?? NONE}
          onValueChange={(value) => onChange(value === NONE ? [] : [String(value)])}
          disabled={disabled}
          className="gap-0"
        >
          {min === 0 ? <OptionRow label="Tidak pakai" control={<RadioGroupItem value={NONE} />} /> : null}
          {group.modifiers.map((m) => (
            <OptionRow
              key={m.id}
              label={m.name}
              delta={m.priceDelta}
              control={<RadioGroupItem value={m.id} aria-label={m.name} />}
            />
          ))}
        </RadioGroup>
      ) : (
        <div>
          {group.modifiers.map((m) => {
            const checked = picked.includes(m.id);
            return (
              <OptionRow
                key={m.id}
                label={m.name}
                delta={m.priceDelta}
                control={
                  <Checkbox
                    checked={checked}
                    aria-label={m.name}
                    disabled={disabled || (!checked && picked.length >= max)}
                    onCheckedChange={(next) =>
                      onChange(next ? [...picked, m.id] : picked.filter((id) => id !== m.id))
                    }
                  />
                }
              />
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function OptionRow({ label, delta = 0, control }: { label: string; delta?: number; control: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-2 text-sm">
      {control}
      <span className="flex-1">{label}</span>
      {delta ? <span className="text-muted-foreground tabular-nums">{formatPriceDelta(delta)}</span> : null}
    </label>
  );
}
