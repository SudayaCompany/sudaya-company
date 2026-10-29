"use client";

import { SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { StockBadge } from "@/components/inventory/stock-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { ItemOption } from "@/lib/inventory/queries";
import { formatQty, stockLevel } from "@/lib/inventory/units";

/** Cari cepat + pilih item (select native → nyaman di HP). */
export function ItemPicker({
  items,
  value,
  onChange,
}: {
  items: ItemOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q));
  }, [items, query]);
  const selected = items.find((i) => i.id === value);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="item">Item</Label>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            const q = e.target.value.trim().toLowerCase();
            const match = items.filter((i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q));
            if (match.length === 1) onChange(match[0].id);
          }}
          placeholder="Cari nama / SKU"
          aria-label="Cari item"
          className="h-11 pl-8"
        />
      </div>
      <NativeSelect id="item" value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full" required>
        <NativeSelectOption value="">{filtered.length ? "Pilih item…" : "Tidak ada item yang cocok"}</NativeSelectOption>
        {filtered.map((i) => (
          <NativeSelectOption key={i.id} value={i.id}>
            {i.name} ({i.sku}) — {formatQty(i.stockQty, i.unit)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {selected ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          Stok sekarang <span className="font-medium text-foreground">{formatQty(selected.stockQty, selected.unit)}</span>
          <StockBadge level={stockLevel(selected.stockQty, selected.minimumStock)} />
        </p>
      ) : null}
    </div>
  );
}
