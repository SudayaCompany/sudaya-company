"use client";

import {
  BanknoteIcon,
  CoffeeIcon,
  Loader2Icon,
  MinusIcon,
  PlusIcon,
  PrinterIcon,
  SearchIcon,
  ShoppingCartIcon,
  Trash2Icon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";

import {
  ItemNotesField,
  ModifierGroupField,
  QuantityStepper,
  useProductSelection,
} from "@/components/catalog/product-options";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MAX_LINE_QUANTITY, priceSelection } from "@/lib/catalog/pricing";
import type { StorefrontProduct } from "@/lib/catalog/storefront";
import { formatPriceDelta, formatRupiah } from "@/lib/format";
import { posCheckoutAction, type PosCheckoutResult } from "@/lib/orders/actions";
import { ORDER_TYPE_LABELS, type OrderType } from "@/lib/orders/state";
import { cn } from "@/lib/utils";

const DESKTOP_QUERY = "(min-width: 1024px)";
function subscribeDesktop(callback: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
/** Keranjang dirender sekali saja: panel samping (desktop) atau sheet (HP). */
function useIsDesktop() {
  return useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_QUERY).matches, () => true);
}

type PosLine = {
  key: string;
  product: StorefrontProduct;
  modifierIds: string[];
  quantity: number;
  notes: string | null;
};

/** Terminal kasir. Harga di layar = perkiraan; harga sah dihitung server. */
export function PosTerminal({
  outlet,
  outlets,
  categories,
  products,
  canConfirmCash,
}: {
  outlet: { id: string; name: string };
  outlets: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  products: StorefrontProduct[];
  canConfirmCash: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [picking, setPicking] = useState<StorefrontProduct | null>(null);
  const [lines, setLines] = useState<PosLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [result, setResult] = useState<PosCheckoutResult | null>(null);
  const desktop = useIsDesktop();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) => (!category || p.categoryId === category) && (!q || p.name.toLowerCase().includes(q)),
    );
  }, [products, category, query]);

  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  function addLine(line: Omit<PosLine, "key">) {
    setLines((current) => {
      const key = `${line.product.id}|${[...line.modifierIds].sort().join(",")}|${line.notes ?? ""}`;
      const existing = current.find((l) => l.key === key);
      if (existing) {
        return current.map((l) =>
          l.key === key ? { ...l, quantity: Math.min(l.quantity + line.quantity, MAX_LINE_QUANTITY) } : l,
        );
      }
      return [...current, { ...line, key }];
    });
  }

  const cart = (
    <PosCart
      outletId={outlet.id}
      lines={lines}
      setLines={setLines}
      canConfirmCash={canConfirmCash}
      onPlaced={(placed) => {
        setCartOpen(false);
        setResult(placed);
      }}
    />
  );

  return (
    <div className="grid flex-1 lg:grid-cols-[1fr_26rem]">
      <section className="flex min-w-0 flex-col gap-3 p-4 pb-28 lg:pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari produk"
              aria-label="Cari produk"
              className="h-11 bg-background pl-9 text-base"
            />
          </div>
          {outlets.length > 1 ? (
            <NativeSelect
              aria-label="Outlet"
              value={outlet.id}
              onChange={(e) => router.push(`/pos?outlet=${e.target.value}`)}
              className="h-11"
            >
              {outlets.map((o) => (
                <NativeSelectOption key={o.id} value={o.id}>{o.name}</NativeSelectOption>
              ))}
            </NativeSelect>
          ) : (
            <span className="text-sm text-muted-foreground">{outlet.name}</span>
          )}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {[{ id: null, name: "Semua" }, ...categories].map((c) => (
            <button
              key={c.id ?? "all"}
              type="button"
              onClick={() => setCategory(c.id)}
              aria-pressed={category === c.id}
              className={cn(
                "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                category === c.id ? "border-neutral-950 bg-neutral-950 text-white" : "bg-background hover:border-foreground",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {products.length === 0 ? "Belum ada menu aktif di outlet ini." : "Produk tidak ditemukan."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {visible.map((product) => (
              <button
                key={product.id}
                type="button"
                disabled={!product.isAvailable}
                onClick={() => setPicking(product)}
                className="flex flex-col overflow-hidden rounded-xl border bg-background text-left transition-shadow hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="relative aspect-[5/3] bg-muted">
                  {product.imageUrl ? (
                    <Image src={product.imageUrl} alt="" fill sizes="200px" className="object-cover" />
                  ) : (
                    <CoffeeIcon className="absolute inset-0 m-auto size-7 text-muted-foreground/40" aria-hidden />
                  )}
                  {!product.isAvailable ? (
                    <Badge variant="destructive" className="absolute top-2 left-2">Sold out</Badge>
                  ) : null}
                </div>
                <div className="flex flex-1 flex-col gap-0.5 p-3">
                  <span className="line-clamp-2 text-sm font-medium">{product.name}</span>
                  <span className="mt-auto text-sm font-semibold tabular-nums">{formatRupiah(product.price)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {desktop ? <aside className="flex flex-col border-l bg-background">{cart}</aside> : null}

      {/* HP/tablet kecil: keranjang sebagai sheet. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background p-3 lg:hidden">
        <Button size="lg" className="h-12 w-full justify-between" onClick={() => setCartOpen(true)}>
          <span className="flex items-center gap-2">
            <ShoppingCartIcon /> {itemCount} item
          </span>
          <span className="tabular-nums">{formatRupiah(estimateTotal(lines))}</span>
        </Button>
      </div>
      <Sheet open={cartOpen && !desktop} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="max-h-[92svh] gap-0 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Keranjang</SheetTitle>
          </SheetHeader>
          {desktop ? null : cart}
        </SheetContent>
      </Sheet>
      <ResultDialog result={result} onClose={() => setResult(null)} />

      <Dialog open={picking !== null} onOpenChange={(open) => !open && setPicking(null)}>
        <DialogContent className="max-h-[90svh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
          {picking ? (
            <ProductPicker
              key={picking.id}
              product={picking}
              onAdd={(line) => {
                addLine(line);
                setPicking(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function estimateTotal(lines: PosLine[]) {
  return lines.reduce((sum, l) => {
    const priced = priceSelection(l.product, l.modifierIds);
    return sum + (priced.ok ? priced.unitPrice * l.quantity : 0);
  }, 0);
}

function ProductPicker({
  product,
  onAdd,
}: {
  product: StorefrontProduct;
  onAdd: (line: Omit<PosLine, "key">) => void;
}) {
  const selection = useProductSelection(product);
  const { priced } = selection;

  return (
    <>
      <DialogHeader className="p-4">
        <DialogTitle>{product.name}</DialogTitle>
        <DialogDescription>{formatRupiah(product.price)}</DialogDescription>
      </DialogHeader>
      {product.groups.map((group) => (
        <ModifierGroupField
          key={group.id}
          group={group}
          selected={selection.selected}
          onChange={(ids) => selection.setGroupSelection(group, ids)}
        />
      ))}
      <ItemNotesField value={selection.notes} onChange={selection.setNotes} />
      <DialogFooter className="m-0 flex-row items-center gap-3 border-t p-4">
        <QuantityStepper value={selection.quantity} onChange={selection.setQuantity} />
        <Button
          size="lg"
          className="h-11 flex-1"
          disabled={!priced.ok}
          onClick={() =>
            onAdd({
              product,
              modifierIds: selection.selected,
              quantity: selection.quantity,
              notes: selection.notes.trim() || null,
            })
          }
        >
          {priced.ok ? `Tambah · ${formatRupiah(priced.unitPrice * selection.quantity)}` : priced.error}
        </Button>
      </DialogFooter>
    </>
  );
}

function PosCart({
  outletId,
  lines,
  setLines,
  canConfirmCash,
  onPlaced,
}: {
  outletId: string;
  lines: PosLine[];
  setLines: React.Dispatch<React.SetStateAction<PosLine[]>>;
  canConfirmCash: boolean;
  onPlaced: (result: PosCheckoutResult) => void;
}) {
  const [type, setType] = useState<OrderType>("takeaway");
  const [customerName, setCustomerName] = useState("");
  const [tableNumber, setTableNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [tendered, setTendered] = useState("");
  const [submitting, startSubmit] = useTransition();
  // Satu key per isi keranjang: klik ganda tidak membuat order ganda.
  const idempotencyKey = useRef<string | null>(null);

  const total = estimateTotal(lines);
  const tenderedAmount = tendered === "" ? null : Number(tendered);
  const cashValid = tenderedAmount !== null && Number.isInteger(tenderedAmount) && tenderedAmount >= total;

  function changeLines(update: (current: PosLine[]) => PosLine[]) {
    idempotencyKey.current = null;
    setLines(update);
  }

  function reset() {
    idempotencyKey.current = null;
    setLines([]);
    setCustomerName("");
    setTableNumber("");
    setNotes("");
    setTendered("");
    setType("takeaway");
  }

  function submit(payNow: boolean) {
    idempotencyKey.current ??= crypto.randomUUID();
    startSubmit(async () => {
      const response = await posCheckoutAction({
        outletId,
        tenderedAmount: payNow ? tenderedAmount : null,
        checkout: {
          idempotencyKey: idempotencyKey.current,
          type,
          customerName: customerName.trim() || undefined,
          tableNumber: type === "dine_in" ? tableNumber.trim() || undefined : undefined,
          notes: notes.trim() || undefined,
          paymentMethod: "cash",
          lines: lines.map((l) => ({
            productId: l.product.id,
            modifierIds: l.modifierIds,
            quantity: l.quantity,
            notes: l.notes ?? undefined,
          })),
        },
      });
      if (!response.ok) {
        toast.error(response.error);
        return;
      }
      if (response.data?.warning) toast.warning(response.data.warning);
      else toast.success(response.message ?? "Pesanan dibuat.");
      reset();
      if (response.data) onPlaced(response.data);
    });
  }

  return (
    <div className="flex h-full max-h-[calc(100svh-3.5rem)] flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="font-semibold">Pesanan baru</h2>
        {lines.length ? (
          <Button size="sm" variant="ghost" onClick={() => changeLines(() => [])}>
            Kosongkan
          </Button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto px-4">
        {lines.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Pilih produk untuk memulai.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {lines.map((line) => {
              const priced = priceSelection(line.product, line.modifierIds);
              return (
                <li key={line.key} className="flex flex-col gap-1.5 py-3">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{line.product.name}</span>
                    <span className="text-sm tabular-nums">
                      {priced.ok ? formatRupiah(priced.unitPrice * line.quantity) : "—"}
                    </span>
                  </div>
                  {priced.ok && priced.modifiers.length ? (
                    <p className="text-xs text-muted-foreground">
                      {priced.modifiers.map((m) => `${m.name}${m.priceDelta ? ` (${formatPriceDelta(m.priceDelta)})` : ""}`).join(", ")}
                    </p>
                  ) : null}
                  {line.notes ? <p className="text-xs text-muted-foreground italic">“{line.notes}”</p> : null}
                  <div className="flex items-center gap-2">
                    <Button size="icon-sm" variant="outline" aria-label="Kurangi" onClick={() => changeLines((c) => c.flatMap((l) => (l.key !== line.key ? [l] : l.quantity > 1 ? [{ ...l, quantity: l.quantity - 1 }] : [])))}>
                      <MinusIcon />
                    </Button>
                    <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                    <Button size="icon-sm" variant="outline" aria-label="Tambah" disabled={line.quantity >= MAX_LINE_QUANTITY} onClick={() => changeLines((c) => c.map((l) => (l.key === line.key ? { ...l, quantity: l.quantity + 1 } : l)))}>
                      <PlusIcon />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Hapus" onClick={() => changeLines((c) => c.filter((l) => l.key !== line.key))}>
                      <Trash2Icon />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t p-4">
        <div className="grid grid-cols-3 gap-1.5">
          {(["takeaway", "dine_in", "delivery"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={type === t}
              onClick={() => setType(t)}
              className={cn(
                "rounded-lg border py-2 text-sm font-medium",
                type === t ? "border-neutral-950 bg-neutral-950 text-white" : "hover:border-foreground",
              )}
            >
              {ORDER_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nama customer" aria-label="Nama customer" maxLength={60} />
          {type === "dine_in" ? (
            <Input value={tableNumber} onChange={(e) => setTableNumber(e.target.value)} placeholder="No. meja" aria-label="Nomor meja" maxLength={10} />
          ) : (
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan order" aria-label="Catatan order" maxLength={300} />
          )}
        </div>

        <div className="flex items-center justify-between text-lg font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatRupiah(total)}</span>
        </div>

        {canConfirmCash ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pos-tendered">Uang tunai diterima</Label>
              <div className="flex gap-1.5">
                <Input
                  id="pos-tendered"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                  className="h-10 tabular-nums"
                />
                <Button type="button" variant="outline" className="h-10" disabled={total === 0} onClick={() => setTendered(String(total))}>
                  Pas
                </Button>
                {[50_000, 100_000].map((v) => (
                  <Button key={v} type="button" variant="outline" className="h-10" disabled={v < total} onClick={() => setTendered(String(v))}>
                    {v / 1000}rb
                  </Button>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                Kembalian:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {cashValid ? formatRupiah(tenderedAmount! - total) : "—"}
                </span>
              </p>
            </div>
            <Button
              size="lg"
              className="h-12 bg-success text-base text-success-foreground hover:bg-success/90"
              disabled={lines.length === 0 || !cashValid || submitting}
              onClick={() => submit(true)}
            >
              {submitting ? <Loader2Icon className="animate-spin" /> : <BanknoteIcon />}
              Bayar tunai & proses
            </Button>
            <Button variant="outline" disabled={lines.length === 0 || submitting} onClick={() => submit(false)}>
              Simpan, bayar nanti
            </Button>
          </>
        ) : (
          <Button size="lg" className="h-12" disabled={lines.length === 0 || submitting} onClick={() => submit(false)}>
            {submitting ? <Loader2Icon className="animate-spin" /> : null}
            Simpan pesanan (bayar di kasir)
          </Button>
        )}
      </div>


    </div>
  );
}

function ResultDialog({ result, onClose }: { result: PosCheckoutResult | null; onClose: () => void }) {
  return (
      <Dialog open={result !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-sm">
          {result ? (
            <>
              <DialogHeader>
                <DialogTitle>{result.orderNumber ? "Pembayaran berhasil" : "Pesanan disimpan"}</DialogTitle>
                <DialogDescription>
                  {result.orderNumber ? "Pesanan masuk antrean barista." : "Menunggu pembayaran di kasir."}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center gap-1 py-2 text-center">
                <span className="text-sm text-muted-foreground">{result.orderNumber ? "Nomor antrean" : "Kode pesanan"}</span>
                <span className="font-mono text-4xl font-bold">{result.orderNumber ?? result.reference}</span>
                <span className="tabular-nums">Total {formatRupiah(result.total)}</span>
                {result.change !== null ? (
                  <span className="text-lg font-semibold tabular-nums">Kembalian {formatRupiah(result.change)}</span>
                ) : null}
              </div>
              <DialogFooter className="flex-col gap-2 sm:flex-col">
                <Link
                  href={`/pos/orders/${result.orderId}/receipt`}
                  target="_blank"
                  className={buttonVariants({ variant: "outline", className: "w-full" })}
                >
                  <PrinterIcon /> Cetak struk
                </Link>
                <Button className="w-full" onClick={onClose}>
                  Pesanan baru
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
  );
}
