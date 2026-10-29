"use client";

import { Loader2Icon, MinusIcon, PlusIcon, ShoppingBagIcon, Trash2Icon } from "lucide-react";
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MAX_LINE_QUANTITY } from "@/lib/catalog/pricing";
import type { CartLineInput, CartQuote } from "@/lib/catalog/quote";
import { formatPriceDelta, formatRupiah } from "@/lib/format";

import { quoteCartAction } from "./actions";

// --- Penyimpanan keranjang (localStorage per outlet) ---------------------------
// Hanya id & jumlah yang disimpan. Harga selalu diambil dari quote server.

const EMPTY: CartLineInput[] = [];

/** Cek bentuk minimal (localStorage bisa diubah manual). Validasi penuh di server. */
function isCartLine(value: unknown): value is CartLineInput {
  const line = value as Partial<CartLineInput> | null;
  return (
    typeof line?.productId === "string" &&
    Array.isArray(line.modifierIds) &&
    line.modifierIds.every((id) => typeof id === "string") &&
    Number.isInteger(line.quantity)
  );
}
const listeners = new Set<() => void>();
const snapshots = new Map<string, { raw: string | null; lines: CartLineInput[] }>();

function read(key: string): CartLineInput[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return EMPTY;
  }
  const cached = snapshots.get(key);
  if (cached && cached.raw === raw) return cached.lines;
  let lines = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) lines = parsed.filter(isCartLine);
  } catch {
    // data rusak → mulai dari kosong
  }
  snapshots.set(key, { raw, lines });
  return lines;
}

function write(key: string, lines: CartLineInput[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(lines));
  } catch {
    // storage penuh/diblokir — keranjang tetap hilang saat reload, tak apa
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = () => listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const sameLine = (a: CartLineInput, b: CartLineInput) =>
  a.productId === b.productId &&
  [...a.modifierIds].sort().join() === [...b.modifierIds].sort().join();

// --- Context -----------------------------------------------------------------

type CartContextValue = {
  outlet: string;
  lines: CartLineInput[];
  quote: CartQuote | null;
  quoting: boolean;
  add: (line: CartLineInput) => void;
  setQuantity: (index: number, quantity: number) => void;
  remove: (index: number) => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function useCart() {
  const cart = use(CartContext);
  if (!cart) throw new Error("useCart harus di dalam CartProvider");
  return cart;
}

export function CartProvider({ outlet, children }: { outlet: string; children: React.ReactNode }) {
  const key = `sudaya:cart:${outlet}`;
  const lines = useSyncExternalStore(subscribe, () => read(key), () => EMPTY);
  const [quote, setQuote] = useState<{ for: string; value: CartQuote } | null>(null);
  const linesKey = JSON.stringify(lines);

  useEffect(() => {
    if (lines.length === 0) return;
    let cancelled = false;
    quoteCartAction({ outlet, lines }).then((value) => {
      if (!cancelled) setQuote({ for: linesKey, value });
    });
    return () => {
      cancelled = true;
    };
    // linesKey mewakili isi `lines`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlet, linesKey]);

  const value = useMemo<CartContextValue>(() => {
    const current = quote?.for === linesKey ? quote.value : null;
    return {
      outlet,
      lines,
      quote: lines.length === 0 ? null : current,
      quoting: lines.length > 0 && current === null,
      add(line) {
        const existing = lines.findIndex((l) => sameLine(l, line));
        write(
          key,
          existing === -1
            ? [...lines, line]
            : lines.map((l, i) =>
                i === existing
                  ? { ...l, quantity: Math.min(l.quantity + line.quantity, MAX_LINE_QUANTITY) }
                  : l,
              ),
        );
      },
      setQuantity(index, quantity) {
        if (quantity < 1) return write(key, lines.filter((_, i) => i !== index));
        write(key, lines.map((l, i) => (i === index ? { ...l, quantity: Math.min(quantity, MAX_LINE_QUANTITY) } : l)));
      },
      remove(index) {
        write(key, lines.filter((_, i) => i !== index));
      },
    };
  }, [key, lines, linesKey, outlet, quote]);

  return <CartContext value={value}>{children}</CartContext>;
}

// --- UI ----------------------------------------------------------------------

export function CartBar() {
  const cart = useCart();
  const [open, setOpen] = useState(false);
  if (cart.lines.length === 0) return null;

  const count = cart.lines.reduce((sum, l) => sum + l.quantity, 0);
  const total = cart.quote?.ok ? cart.quote.total : null;

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mx-auto flex w-full max-w-lg items-center gap-3 rounded-2xl bg-neutral-950 px-4 py-3 text-left text-white shadow-xl transition-transform active:scale-[0.99]"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand text-brand-foreground">
            <ShoppingBagIcon className="size-5" aria-hidden />
          </span>
          <span className="flex-1">
            <span className="block text-sm font-medium">{count} item</span>
            <span className="block text-xs text-neutral-400">Lihat keranjang</span>
          </span>
          <span className="text-base font-semibold tabular-nums">
            {total === null ? <Loader2Icon className="size-4 animate-spin" /> : formatRupiah(total)}
          </span>
        </button>
      </div>
      <CartSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

function CartSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const cart = useCart();
  const quote = cart.quote;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[90svh] w-full max-w-lg rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Keranjang</SheetTitle>
          <SheetDescription>Harga dihitung ulang oleh server.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4">
          {quote && !quote.ok ? (
            <p role="alert" className="text-sm text-destructive">{quote.error}</p>
          ) : null}
          <ul className="flex flex-col divide-y">
            {cart.lines.map((line, index) => {
              const quoted = quote?.ok ? quote.lines[index] : null;
              return (
                <li key={`${line.productId}:${line.modifierIds.join()}`} className="flex gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{quoted?.name ?? "Memuat…"}</p>
                    {quoted?.ok && quoted.modifiers.length ? (
                      <p className="text-xs text-muted-foreground">
                        {quoted.modifiers.map((m) => `${m.name}${m.priceDelta ? ` (${formatPriceDelta(m.priceDelta)})` : ""}`).join(", ")}
                      </p>
                    ) : null}
                    {quoted && !quoted.ok ? (
                      <p className="text-xs text-destructive">{quoted.error}</p>
                    ) : null}
                    <div className="mt-2 flex items-center gap-2">
                      <Button size="icon-sm" variant="outline" aria-label="Kurangi" onClick={() => cart.setQuantity(index, line.quantity - 1)}>
                        <MinusIcon />
                      </Button>
                      <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                      <Button size="icon-sm" variant="outline" aria-label="Tambah" onClick={() => cart.setQuantity(index, line.quantity + 1)}>
                        <PlusIcon />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Hapus item" onClick={() => cart.remove(index)}>
                        <Trash2Icon />
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm font-medium tabular-nums">
                    {quoted?.ok ? formatRupiah(quoted.lineTotal) : "—"}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
        <SheetFooter className="border-t">
          <div className="flex items-center justify-between text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">
              {quote?.ok ? formatRupiah(quote.total) : <Loader2Icon className="size-4 animate-spin" />}
            </span>
          </div>
          <Button size="lg" className="h-11" disabled>
            Checkout segera hadir
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Pembayaran & nomor antrean tersedia di tahap berikutnya.
          </p>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
