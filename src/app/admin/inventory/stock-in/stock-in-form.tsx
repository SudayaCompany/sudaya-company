"use client";

import { Loader2Icon } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { stockInAction } from "@/lib/inventory/actions";
import type { ItemOption } from "@/lib/inventory/queries";
import { STOCK_IN_LABELS, STOCK_IN_TYPES } from "@/lib/inventory/schemas";
import { compatibleUnits, convertQty, formatQty, isUnitCode, qtyFromDb, type UnitCode } from "@/lib/inventory/units";

import { ItemPicker } from "../item-picker";

const field = "flex flex-col gap-1.5";

export function StockInForm({ items, today }: { items: ItemOption[]; today: string }) {
  const [itemId, setItemId] = useState("");
  const item = items.find((i) => i.id === itemId);
  const baseUnit = item && isUnitCode(item.unit) ? item.unit : null;
  const [unit, setUnit] = useState<UnitCode | null>(null);
  const inputUnit = unit && baseUnit && compatibleUnits(baseUnit).includes(unit) ? unit : baseUnit;
  const [quantity, setQuantity] = useState("");
  const [type, setType] = useState<(typeof STOCK_IN_TYPES)[number]>("purchase");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  // Satu key per percobaan simpan: klik ganda / retry → satu movement saja.
  const idempotencyKey = useRef<string | null>(null);

  const converted = item && baseUnit && inputUnit && quantity.trim() ? convertQty(quantity, inputUnit, baseUnit) : null;
  const preview = converted?.ok && item ? qtyFromDb(item.stockQty) + converted.milli : null;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item || !inputUnit) return;
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim() || undefined;
    idempotencyKey.current ??= crypto.randomUUID();
    setError(null);
    startTransition(async () => {
      const result = await stockInAction({
        idempotencyKey: idempotencyKey.current,
        itemId: item.id,
        type,
        quantity,
        unit: inputUnit,
        effectiveDate: text("effectiveDate"),
        unitCost: text("unitCost"),
        documentRef: text("documentRef"),
        batchCode: text("batchCode"),
        expiryDate: text("expiryDate"),
        notes: text("notes"),
      });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Tersimpan.");
      idempotencyKey.current = null;
      setQuantity("");
      setItemId("");
      setUnit(null);
      formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-4">
      <ItemPicker items={items} value={itemId} onChange={(id) => { setItemId(id); setUnit(null); }} />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Jenis</legend>
        <div className="grid grid-cols-2 gap-2">
          {STOCK_IN_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={type === t}
              onClick={() => setType(t)}
              className={
                type === t
                  ? "rounded-xl border border-neutral-950 bg-neutral-950 py-2.5 text-sm font-medium text-white"
                  : "rounded-xl border py-2.5 text-sm font-medium hover:border-foreground"
              }
            >
              {STOCK_IN_LABELS[t]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <div className={field}>
          <Label htmlFor="quantity">Jumlah</Label>
          <Input
            id="quantity"
            inputMode="decimal"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="h-11 text-lg"
            placeholder="0"
          />
        </div>
        <div className={field}>
          <Label htmlFor="unit">Satuan</Label>
          <NativeSelect
            id="unit"
            value={inputUnit ?? ""}
            onChange={(e) => setUnit(e.target.value as UnitCode)}
            disabled={!baseUnit}
            className="h-11 w-full"
          >
            {(baseUnit ? compatibleUnits(baseUnit) : []).map((u) => (
              <NativeSelectOption key={u} value={u}>{u}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      {converted && !converted.ok ? (
        <p className="text-sm text-destructive">{converted.error}</p>
      ) : preview !== null && item ? (
        <p className="text-sm text-muted-foreground">
          Saldo setelah disimpan: <span className="font-medium text-foreground">{formatQty(preview, item.unit)}</span>
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className={field}>
          <Label htmlFor="effectiveDate">Tanggal</Label>
          <Input id="effectiveDate" name="effectiveDate" type="date" required defaultValue={today} max={today} className="h-11" />
        </div>
        <div className={field}>
          <Label htmlFor="documentRef">Referensi <span className="text-xs font-normal text-muted-foreground">(no. nota/faktur)</span></Label>
          <Input id="documentRef" name="documentRef" maxLength={60} className="h-11" />
        </div>
        <div className={field}>
          <Label htmlFor="unitCost">
            Harga per {inputUnit ?? "satuan"} (Rp) <span className="text-xs font-normal text-muted-foreground">(opsional)</span>
          </Label>
          <Input id="unitCost" name="unitCost" inputMode="decimal" className="h-11" />
        </div>
        <div className={field}>
          <Label htmlFor="batchCode">Batch <span className="text-xs font-normal text-muted-foreground">(opsional)</span></Label>
          <Input id="batchCode" name="batchCode" maxLength={40} className="h-11" />
        </div>
        <div className={field}>
          <Label htmlFor="expiryDate">Kedaluwarsa <span className="text-xs font-normal text-muted-foreground">(opsional)</span></Label>
          <Input id="expiryDate" name="expiryDate" type="date" className="h-11" />
        </div>
      </div>
      {type === "purchase" ? (
        <p className="text-xs text-muted-foreground">Harga pembelian terbaru menjadi harga pokok item (dipakai untuk nilai stok & waste).</p>
      ) : null}
      <div className={field}>
        <Label htmlFor="notes">Catatan</Label>
        <Textarea id="notes" name="notes" maxLength={300} rows={2} />
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        <Button type="submit" size="lg" className="h-12 w-full text-base md:w-auto" disabled={pending || !item || !quantity.trim()}>
          {pending ? <Loader2Icon className="animate-spin" /> : null} Simpan stok masuk
        </Button>
      </div>
    </form>
  );
}
