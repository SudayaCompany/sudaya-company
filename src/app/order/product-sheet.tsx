"use client";

import { CoffeeIcon, Loader2Icon } from "lucide-react";
import Image from "next/image";
import { useTransition } from "react";
import { toast } from "sonner";

import {
  ItemNotesField,
  ModifierGroupField,
  QuantityStepper,
  useProductSelection,
} from "@/components/catalog/product-options";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetTitle,
} from "@/components/ui/sheet";
import type { StorefrontProduct } from "@/lib/catalog/storefront";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

import { quoteCartAction } from "./actions";
import { useCart } from "./cart";

export function ProductSheet({
  product,
  onOpenChange,
}: {
  product: StorefrontProduct | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { mode } = useCart();
  return (
    <Sheet open={product !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cn(
          "mx-auto max-h-[92svh] w-full gap-0 overflow-hidden rounded-t-2xl p-0",
          mode === "kiosk" ? "max-w-2xl" : "max-w-lg",
        )}
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
  const large = cart.mode === "kiosk";
  const selection = useProductSelection(product);
  const { priced, quantity } = selection;
  const [adding, startAdding] = useTransition();

  function add() {
    const line = {
      productId: product.id,
      modifierIds: selection.selected,
      quantity,
      notes: selection.notes.trim() || null,
    };
    startAdding(async () => {
      // Validasi ke server sebelum masuk keranjang (harga & ketersediaan terbaru).
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
            <Image src={product.imageUrl} alt={product.name} fill sizes="(max-width: 640px) 100vw, 672px" className="object-cover" />
          ) : (
            <CoffeeIcon className="absolute inset-0 m-auto size-12 text-muted-foreground/50" aria-hidden />
          )}
        </div>
        <div className="flex flex-col gap-1 p-4">
          <SheetTitle className={large ? "text-2xl" : "text-xl"}>{product.name}</SheetTitle>
          {product.description ? (
            <SheetDescription>{product.description}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">Detail produk</SheetDescription>
          )}
          <p className={cn("mt-1 font-semibold tabular-nums", large && "text-lg")}>{formatRupiah(product.price)}</p>
          {!product.isAvailable ? <Badge variant="destructive" className="mt-1 w-fit">Sold out</Badge> : null}
        </div>

        {product.groups.map((group) => (
          <ModifierGroupField
            key={group.id}
            group={group}
            large={large}
            selected={selection.selected}
            disabled={!product.isAvailable}
            onChange={(ids) => selection.setGroupSelection(group, ids)}
          />
        ))}
        <ItemNotesField value={selection.notes} onChange={selection.setNotes} disabled={!product.isAvailable} />
      </div>

      <SheetFooter className="flex-row items-center gap-3 border-t bg-background p-4">
        <QuantityStepper value={quantity} onChange={selection.setQuantity} disabled={!product.isAvailable} large={large} />
        <Button size="lg" className={cn("flex-1", large ? "h-14 text-lg" : "h-11")} disabled={!priced.ok || adding} onClick={add}>
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
