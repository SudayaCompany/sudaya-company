"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_LINE_QUANTITY,
  defaultSelection,
  priceSelection,
  selectionLimits,
  type PricingGroup,
  type PricingProduct,
} from "@/lib/catalog/pricing";
import { formatPriceDelta } from "@/lib/format";
import { cn } from "@/lib/utils";

// Pilihan produk (modifier, jumlah, catatan) yang dipakai bersama oleh
// /order, /kiosk, dan /pos. Harga di sini hanya tampilan — server selalu
// menghitung ulang saat checkout.

const NONE = "__none__";
export const MAX_ITEM_NOTES = 140;

export function useProductSelection(
  product: PricingProduct & { defaultModifierIds?: string[] },
) {
  const [selected, setSelected] = useState<string[]>(() =>
    defaultSelection(product, new Set(product.defaultModifierIds ?? [])),
  );
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  function setGroupSelection(group: PricingGroup, ids: string[]) {
    const groupIds = new Set(group.modifiers.map((m) => m.id));
    setSelected((current) => [...current.filter((id) => !groupIds.has(id)), ...ids]);
  }

  return {
    selected,
    setGroupSelection,
    quantity,
    setQuantity,
    notes,
    setNotes,
    priced: priceSelection(product, selected),
  };
}

export function ModifierGroupField({
  group,
  selected,
  disabled,
  large,
  onChange,
}: {
  group: PricingGroup;
  selected: string[];
  disabled?: boolean;
  large?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const { min, max } = selectionLimits(group);
  const picked = group.modifiers.filter((m) => selected.includes(m.id)).map((m) => m.id);
  const hint =
    group.selection === "single" ? "Pilih 1" : min > 0 ? `Pilih ${min}–${max}` : `Maks ${max}`;

  return (
    <fieldset className="border-t px-4 py-3">
      <legend className="sr-only">{group.name}</legend>
      <div className="mb-2 flex items-center justify-between">
        <span className={cn("font-medium", large && "text-lg")}>{group.name}</span>
        <span className="text-xs text-muted-foreground">
          <Badge variant={min > 0 ? "default" : "outline"} className="mr-1.5">
            {min > 0 ? "Wajib" : "Opsional"}
          </Badge>
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
          {min === 0 ? (
            <OptionRow large={large} label="Tidak pakai" control={<RadioGroupItem value={NONE} />} />
          ) : null}
          {group.modifiers.map((m) => (
            <OptionRow
              key={m.id}
              large={large}
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
                large={large}
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

function OptionRow({
  label,
  delta = 0,
  control,
  large,
}: {
  label: string;
  delta?: number;
  control: React.ReactNode;
  large?: boolean;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-3 text-sm", large ? "py-3 text-base" : "py-2")}>
      {control}
      <span className="flex-1">{label}</span>
      {delta ? <span className="text-muted-foreground tabular-nums">{formatPriceDelta(delta)}</span> : null}
    </label>
  );
}

export function QuantityStepper({
  value,
  onChange,
  disabled,
  large,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  large?: boolean;
}) {
  // Kiosk: target sentuh 48px.
  const sizeClass = large ? "size-12" : undefined;
  return (
    <div className="flex items-center gap-2">
      <Button
        size="icon"
        className={sizeClass}
        variant="outline"
        aria-label="Kurangi jumlah"
        disabled={disabled || value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <MinusIcon />
      </Button>
      <span className={cn("w-7 text-center tabular-nums", large && "text-lg")} aria-live="polite">
        {value}
      </span>
      <Button
        size="icon"
        className={sizeClass}
        variant="outline"
        aria-label="Tambah jumlah"
        disabled={disabled || value >= MAX_LINE_QUANTITY}
        onClick={() => onChange(value + 1)}
      >
        <PlusIcon />
      </Button>
    </div>
  );
}

export function ItemNotesField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="border-t px-4 py-3">
      <label htmlFor="item-notes" className="mb-2 block font-medium">
        Catatan <span className="text-xs font-normal text-muted-foreground">(opsional)</span>
      </label>
      <Textarea
        id="item-notes"
        value={value}
        maxLength={MAX_ITEM_NOTES}
        rows={2}
        disabled={disabled}
        placeholder="mis. es sedikit, tanpa sedotan"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
