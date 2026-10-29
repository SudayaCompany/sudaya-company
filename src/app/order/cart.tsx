"use client";

import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  Loader2Icon,
  MinusIcon,
  PlusIcon,
  ShoppingBagIcon,
  Trash2Icon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { MAX_LINE_QUANTITY } from "@/lib/catalog/pricing";
import type { CartLineInput, CartQuote } from "@/lib/catalog/quote";
import { formatPriceDelta, formatRupiah } from "@/lib/format";
import { placeOrder } from "@/lib/orders/place-order";
import type { OrderType } from "@/lib/orders/state";
import { ORDER_TYPE_LABELS } from "@/lib/orders/state";
import { paymentOptions } from "@/lib/payments/provider";
import { cn } from "@/lib/utils";

import { quoteCartAction } from "./actions";

export type CartLine = CartLineInput & { notes?: string | null };
export type StorefrontMode = "order" | "kiosk";
type PublicChannel = "qr_table" | "qr_counter" | "website" | "kiosk";

// --- Penyimpanan keranjang (localStorage per outlet & mode) ----------------------
// Hanya id, jumlah, dan catatan yang disimpan. Harga selalu dari quote server.

const EMPTY: CartLine[] = [];
const listeners = new Set<() => void>();
const snapshots = new Map<string, { raw: string | null; lines: CartLine[] }>();

/** Cek bentuk minimal (localStorage bisa diubah manual). Validasi penuh di server. */
function isCartLine(value: unknown): value is CartLine {
  const line = value as Partial<CartLine> | null;
  return (
    typeof line?.productId === "string" &&
    Array.isArray(line.modifierIds) &&
    line.modifierIds.every((id) => typeof id === "string") &&
    Number.isInteger(line.quantity) &&
    (line.notes === undefined || line.notes === null || typeof line.notes === "string")
  );
}

function read(key: string): CartLine[] {
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

function write(key: string, lines: CartLine[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(lines));
  } catch {
    // storage penuh/diblokir — keranjang hilang saat reload, tak apa
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

const sameLine = (a: CartLine, b: CartLine) =>
  a.productId === b.productId &&
  (a.notes ?? "") === (b.notes ?? "") &&
  [...a.modifierIds].sort().join() === [...b.modifierIds].sort().join();

// --- Context -----------------------------------------------------------------

type CartContextValue = {
  outlet: string;
  channel: PublicChannel;
  mode: StorefrontMode;
  table: string | null;
  lines: CartLine[];
  quote: CartQuote | null;
  quoting: boolean;
  add: (line: CartLine) => void;
  setQuantity: (index: number, quantity: number) => void;
  remove: (index: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function useCart() {
  const cart = use(CartContext);
  if (!cart) throw new Error("useCart harus di dalam CartProvider");
  return cart;
}

export function CartProvider({
  outlet,
  channel,
  mode,
  table,
  children,
}: {
  outlet: string;
  channel: PublicChannel;
  mode: StorefrontMode;
  table: string | null;
  children: React.ReactNode;
}) {
  const key = `sudaya:cart:${mode}:${outlet}`;
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
      channel,
      mode,
      table,
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
      clear() {
        write(key, []);
      },
    };
  }, [channel, key, lines, linesKey, mode, outlet, quote, table]);

  return <CartContext value={value}>{children}</CartContext>;
}

// --- UI ----------------------------------------------------------------------

export function CartBar() {
  const cart = useCart();
  const [open, setOpen] = useState(false);
  const [placed, setPlaced] = useState<{ reference: string; total: number } | null>(null);
  const kiosk = cart.mode === "kiosk";

  return (
    <>
      {cart.lines.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cn(
              "mx-auto flex w-full max-w-lg items-center gap-3 rounded-2xl bg-neutral-950 px-4 text-left text-white shadow-xl transition-transform active:scale-[0.99]",
              kiosk ? "max-w-2xl py-5" : "py-3",
            )}
          >
            <span className={cn("flex items-center justify-center rounded-xl bg-brand text-brand-foreground", kiosk ? "size-14" : "size-10")}>
              <ShoppingBagIcon className={kiosk ? "size-7" : "size-5"} aria-hidden />
            </span>
            <span className="flex-1">
              <span className={cn("block font-medium", kiosk ? "text-lg" : "text-sm")}>
                {cart.lines.reduce((sum, l) => sum + l.quantity, 0)} item
              </span>
              <span className={cn("block text-neutral-400", kiosk ? "text-sm" : "text-xs")}>
                Lihat keranjang
              </span>
            </span>
            <span className={cn("font-semibold tabular-nums", kiosk ? "text-xl" : "text-base")}>
              {cart.quote?.ok ? formatRupiah(cart.quote.total) : <Loader2Icon className="size-4 animate-spin" />}
            </span>
          </button>
        </div>
      ) : null}
      <CartSheet open={open} onOpenChange={setOpen} onKioskPlaced={setPlaced} />
      {placed ? <KioskConfirmation {...placed} onDone={() => setPlaced(null)} /> : null}
    </>
  );
}

function CartSheet({
  open,
  onOpenChange,
  onKioskPlaced,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onKioskPlaced: (placed: { reference: string; total: number }) => void;
}) {
  const cart = useCart();
  const [step, setStep] = useState<"cart" | "checkout">("cart");
  const quote = cart.quote;
  const kiosk = cart.mode === "kiosk";
  const canCheckout = quote?.ok === true && quote.lines.every((l) => l.ok) && cart.lines.length > 0;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setStep("cart");
      }}
    >
      <SheetContent side="bottom" className={cn("mx-auto max-h-[92svh] w-full rounded-t-2xl", kiosk ? "max-w-2xl" : "max-w-lg")}>
        {step === "cart" ? (
          <>
            <SheetHeader>
              <SheetTitle className={kiosk ? "text-2xl" : undefined}>Keranjang</SheetTitle>
              <SheetDescription>Harga dihitung ulang oleh server.</SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-4">
              {quote && !quote.ok ? <p role="alert" className="text-sm text-destructive">{quote.error}</p> : null}
              {cart.lines.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Keranjang kosong.</p>
              ) : null}
              <ul className="flex flex-col divide-y">
                {cart.lines.map((line, index) => {
                  const quoted = quote?.ok ? quote.lines[index] : null;
                  return (
                    <li key={`${line.productId}:${line.modifierIds.join()}:${line.notes ?? ""}`} className="flex gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className={cn("font-medium", kiosk && "text-lg")}>{quoted?.name ?? "Memuat…"}</p>
                        {quoted?.ok && quoted.modifiers.length ? (
                          <p className="text-xs text-muted-foreground">
                            {quoted.modifiers.map((m) => `${m.name}${m.priceDelta ? ` (${formatPriceDelta(m.priceDelta)})` : ""}`).join(", ")}
                          </p>
                        ) : null}
                        {line.notes ? <p className="text-xs text-muted-foreground italic">“{line.notes}”</p> : null}
                        {quoted && !quoted.ok ? <p className="text-xs text-destructive">{quoted.error}</p> : null}
                        <div className="mt-2 flex items-center gap-2">
                          <Button size={kiosk ? "icon-lg" : "icon-sm"} variant="outline" aria-label="Kurangi" onClick={() => cart.setQuantity(index, line.quantity - 1)}>
                            <MinusIcon />
                          </Button>
                          <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                          <Button size={kiosk ? "icon-lg" : "icon-sm"} variant="outline" aria-label="Tambah" onClick={() => cart.setQuantity(index, line.quantity + 1)}>
                            <PlusIcon />
                          </Button>
                          <Button size={kiosk ? "icon-lg" : "icon-sm"} variant="ghost" aria-label="Hapus item" onClick={() => cart.remove(index)}>
                            <Trash2Icon />
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm font-medium tabular-nums">{quoted?.ok ? formatRupiah(quoted.lineTotal) : "—"}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
            <SheetFooter className="border-t">
              <div className="flex items-center justify-between text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">
                  {quote?.ok ? formatRupiah(quote.total) : cart.lines.length ? <Loader2Icon className="size-4 animate-spin" /> : formatRupiah(0)}
                </span>
              </div>
              <Button size="lg" className={kiosk ? "h-14 text-lg" : "h-11"} disabled={!canCheckout} onClick={() => setStep("checkout")}>
                Lanjut ke checkout
              </Button>
            </SheetFooter>
          </>
        ) : (
          <CheckoutForm
            onBack={() => setStep("cart")}
            onPlaced={(result) => {
              onOpenChange(false);
              setStep("cart");
              if (kiosk) onKioskPlaced(result);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function CheckoutForm({
  onBack,
  onPlaced,
}: {
  onBack: () => void;
  onPlaced: (result: { reference: string; total: number }) => void;
}) {
  const cart = useCart();
  const router = useRouter();
  const kiosk = cart.mode === "kiosk";
  const [type, setType] = useState<OrderType>(cart.table ? "dine_in" : "takeaway");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "qris">("cash");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  // Satu key per percobaan checkout: klik ganda / retry → order yang sama.
  const idempotencyKey = useRef<string | null>(null);
  const types: OrderType[] = kiosk ? ["dine_in", "takeaway"] : ["dine_in", "takeaway", "delivery"];
  const total = cart.quote?.ok ? cart.quote.total : null;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim() || undefined;
    idempotencyKey.current ??= crypto.randomUUID();
    setError(null);
    startSubmit(async () => {
      const result = await placeOrder({
        outlet: cart.outlet,
        channel: cart.channel,
        checkout: {
          idempotencyKey: idempotencyKey.current,
          type,
          customerName: text("customerName"),
          customerPhone: text("customerPhone"),
          tableNumber: type === "dine_in" ? text("tableNumber") : undefined,
          deliveryAddress: type === "delivery" ? text("deliveryAddress") : undefined,
          notes: text("notes"),
          paymentMethod,
          lines: cart.lines.map((l) => ({ ...l, notes: l.notes ?? undefined })),
        },
      });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      idempotencyKey.current = null;
      cart.clear();
      onPlaced(result);
      if (!kiosk) router.push(`/order/status/${result.orderId}`);
    });
  }

  const fieldClass = kiosk ? "h-12 text-lg" : "h-10";

  return (
    <form onSubmit={submit} className="flex max-h-[92svh] flex-col">
      <SheetHeader>
        <div className="flex items-center gap-2">
          <Button type="button" size="icon-sm" variant="ghost" onClick={onBack} aria-label="Kembali ke keranjang">
            <ArrowLeftIcon />
          </Button>
          <SheetTitle className={kiosk ? "text-2xl" : undefined}>Checkout</SheetTitle>
        </div>
        <SheetDescription>Isi data pemesan. Pembayaran dikonfirmasi kasir.</SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-2">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Tipe pesanan</legend>
          <div className={cn("grid gap-2", types.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
            {types.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                onClick={() => setType(t)}
                className={cn(
                  "rounded-xl border px-3 text-sm font-medium transition-colors",
                  kiosk ? "py-4 text-lg" : "py-2.5",
                  type === t ? "border-neutral-950 bg-neutral-950 text-white" : "hover:border-foreground",
                )}
              >
                {ORDER_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </fieldset>

        {type === "dine_in" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tableNumber">Nomor meja{kiosk ? " (opsional)" : ""}</Label>
            <Input id="tableNumber" name="tableNumber" defaultValue={cart.table ?? ""} maxLength={10} className={fieldClass} placeholder="mis. T03" />
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="customerName">Nama pemesan</Label>
          <Input id="customerName" name="customerName" required minLength={2} maxLength={60} autoComplete="name" className={fieldClass} />
        </div>

        {kiosk ? null : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customerPhone">
              Nomor HP {type === "delivery" ? "" : <span className="text-xs font-normal text-muted-foreground">(opsional)</span>}
            </Label>
            <Input id="customerPhone" name="customerPhone" type="tel" inputMode="tel" autoComplete="tel" required={type === "delivery"} className={fieldClass} placeholder="0812xxxxxxx" />
          </div>
        )}

        {type === "delivery" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deliveryAddress">Alamat lengkap</Label>
            <Textarea id="deliveryAddress" name="deliveryAddress" required minLength={10} maxLength={300} rows={3} autoComplete="street-address" placeholder="Jalan, nomor, patokan" />
            <p className="text-xs text-muted-foreground">Ongkir & waktu antar dikonfirmasi langsung oleh outlet.</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">Catatan pesanan <span className="text-xs font-normal text-muted-foreground">(opsional)</span></Label>
          <Textarea id="notes" name="notes" maxLength={300} rows={2} />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Pembayaran</legend>
          {paymentOptions().map((option) => (
            <label
              key={option.method}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3 text-sm",
                option.available ? "cursor-pointer has-checked:border-neutral-950" : "cursor-not-allowed opacity-50",
              )}
            >
              <input
                type="radio"
                name="paymentMethod"
                value={option.method}
                checked={paymentMethod === option.method}
                disabled={!option.available}
                onChange={() => setPaymentMethod(option.method)}
                className="accent-neutral-950"
              />
              <span className="flex-1 font-medium">{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.note}</span>
            </label>
          ))}
        </fieldset>

        {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      </div>

      <SheetFooter className="border-t">
        <Button type="submit" size="lg" className={kiosk ? "h-14 text-lg" : "h-11"} disabled={submitting || total === null}>
          {submitting ? <Loader2Icon className="animate-spin" /> : null}
          {submitting ? "Mengirim…" : `Kirim pesanan · ${total === null ? "…" : formatRupiah(total)}`}
        </Button>
      </SheetFooter>
    </form>
  );
}

/** Layar konfirmasi kiosk; kembali ke menu otomatis untuk customer berikutnya. */
function KioskConfirmation({ reference, total, onDone }: { reference: string; total: number; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 45_000);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="kiosk-done" className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/95 p-6 text-white">
      <div className="flex w-full max-w-xl flex-col items-center gap-6 text-center">
        <CheckCircle2Icon className="size-16 text-success" aria-hidden />
        <h2 id="kiosk-done" className="text-3xl font-semibold">Pesanan diterima</h2>
        <div className="rounded-2xl bg-white/10 px-8 py-5">
          <p className="text-sm text-neutral-400">Kode pesanan</p>
          <p className="font-mono text-5xl font-bold tracking-widest">{reference}</p>
        </div>
        <p className="text-lg">
          Status pembayaran: <span className="font-semibold text-brand">Menunggu pembayaran</span>
        </p>
        <p className="text-neutral-300">
          Silakan bayar <span className="font-semibold text-white">{formatRupiah(total)}</span> di kasir dengan menyebutkan kode di atas.
          Nomor antrean diberikan setelah pembayaran.
        </p>
        <Button size="lg" className="h-14 w-full max-w-xs bg-brand text-lg text-brand-foreground hover:bg-brand/90" onClick={onDone}>
          Selesai
        </Button>
      </div>
    </div>
  );
}
