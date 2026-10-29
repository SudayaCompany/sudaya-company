"use client";

import { CameraIcon, Loader2Icon } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { stockOutAction } from "@/lib/inventory/actions";
import { EVIDENCE_TYPES, MAX_EVIDENCE_BYTES } from "@/lib/inventory/evidence-types";
import type { ItemOption } from "@/lib/inventory/queries";
import { ISSUE_REASONS, STOCK_OUT_REASON_CODES, WASTE_REASON_CODES, type IssueReason } from "@/lib/inventory/schemas";
import { compatibleUnits, convertQty, formatQty, isUnitCode, qtyFromDb, type UnitCode } from "@/lib/inventory/units";
import { cn } from "@/lib/utils";

import { ItemPicker } from "./item-picker";

const field = "flex flex-col gap-1.5";

/** Form stok keluar (mode "out") atau waste (mode "waste"), dengan foto bukti opsional. */
export function IssueForm({ items, mode }: { items: ItemOption[]; mode: "out" | "waste" }) {
  const reasons = mode === "waste" ? WASTE_REASON_CODES : STOCK_OUT_REASON_CODES;
  const [itemId, setItemId] = useState("");
  const item = items.find((i) => i.id === itemId);
  const baseUnit = item && isUnitCode(item.unit) ? item.unit : null;
  const [unit, setUnit] = useState<UnitCode | null>(null);
  const inputUnit = unit && baseUnit && compatibleUnits(baseUnit).includes(unit) ? unit : baseUnit;
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<IssueReason>(reasons[0]);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const idempotencyKey = useRef<string | null>(null);

  const converted = item && baseUnit && inputUnit && quantity.trim() ? convertQty(quantity, inputUnit, baseUnit) : null;
  const preview = converted?.ok && item ? qtyFromDb(item.stockQty) - converted.milli : null;
  const notesRequired = reason === "stock_out" || reason === "other_waste";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item || !inputUnit) return;
    const form = new FormData(event.currentTarget);
    const photo = form.get("photo");
    if (photo instanceof File && photo.size > MAX_EVIDENCE_BYTES) {
      setError("Ukuran foto bukti maksimal 3 MB.");
      return;
    }
    idempotencyKey.current ??= crypto.randomUUID();
    form.set("idempotencyKey", idempotencyKey.current);
    form.set("itemId", item.id);
    form.set("reason", reason);
    form.set("quantity", quantity);
    form.set("unit", inputUnit);
    setError(null);
    startTransition(async () => {
      const result = await stockOutAction(form);
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
      setPhotoName(null);
      formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-4">
      <ItemPicker items={items} value={itemId} onChange={(id) => { setItemId(id); setUnit(null); }} />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Alasan</legend>
        <div className={cn("grid gap-2", reasons.length > 2 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
          {reasons.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              onClick={() => setReason(r)}
              className={cn(
                "rounded-xl border px-2 py-2.5 text-sm font-medium",
                reason === r ? "border-neutral-950 bg-neutral-950 text-white" : "hover:border-foreground",
              )}
            >
              {ISSUE_REASONS[r].label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <div className={field}>
          <Label htmlFor="quantity">Jumlah</Label>
          <Input id="quantity" inputMode="decimal" required value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-11 text-lg" placeholder="0" />
        </div>
        <div className={field}>
          <Label htmlFor="unit">Satuan</Label>
          <NativeSelect id="unit" value={inputUnit ?? ""} onChange={(e) => setUnit(e.target.value as UnitCode)} disabled={!baseUnit} className="h-11 w-full">
            {(baseUnit ? compatibleUnits(baseUnit) : []).map((u) => (
              <NativeSelectOption key={u} value={u}>{u}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      {converted && !converted.ok ? (
        <p className="text-sm text-destructive">{converted.error}</p>
      ) : preview !== null && item ? (
        <p className={cn("text-sm", preview < 0n ? "font-medium text-destructive" : "text-muted-foreground")}>
          {preview < 0n
            ? `Melebihi stok (tersisa ${formatQty(item.stockQty, item.unit)}).`
            : `Saldo setelah disimpan: ${formatQty(preview, item.unit)}`}
        </p>
      ) : null}

      <div className={field}>
        <Label htmlFor="notes">Catatan{notesRequired ? "" : " (opsional)"}</Label>
        <Textarea id="notes" name="notes" maxLength={300} rows={2} required={notesRequired} minLength={notesRequired ? 3 : undefined} />
      </div>

      <div className={field}>
        <Label htmlFor="photo">Foto bukti (opsional)</Label>
        <label
          htmlFor="photo"
          className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground hover:border-foreground"
        >
          <CameraIcon className="size-4" /> {photoName ?? "Ambil / pilih foto (JPG, PNG, WebP, maks 3 MB)"}
        </label>
        <input
          id="photo"
          name="photo"
          type="file"
          accept={EVIDENCE_TYPES.join(",")}
          capture="environment"
          className="sr-only"
          onChange={(e) => setPhotoName(e.target.files?.[0]?.name ?? null)}
        />
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        <Button
          type="submit"
          size="lg"
          variant={mode === "waste" ? "destructive" : "default"}
          className="h-12 w-full text-base md:w-auto"
          disabled={pending || !item || !quantity.trim() || (preview !== null && preview < 0n)}
        >
          {pending ? <Loader2Icon className="animate-spin" /> : null}
          {mode === "waste" ? "Catat waste" : "Simpan stok keluar"}
        </Button>
      </div>
    </form>
  );
}
