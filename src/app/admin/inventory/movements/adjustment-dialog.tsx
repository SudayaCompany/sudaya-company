"use client";

import { Loader2Icon, ScaleIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/hooks/use-action-toast";
import { requestAdjustmentAction } from "@/lib/inventory/actions";
import type { ItemOption } from "@/lib/inventory/queries";
import { compatibleUnits, isUnitCode, type UnitCode } from "@/lib/inventory/units";
import { cn } from "@/lib/utils";

import { ItemPicker } from "../item-picker";

/** Ajukan koreksi stok manual (+/−). Stok berubah hanya setelah approval. */
export function AdjustmentDialog({ items }: { items: ItemOption[] }) {
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<UnitCode | null>(null);
  const [reason, setReason] = useState("");
  const { pending, run } = useActionToast();
  const item = items.find((i) => i.id === itemId);
  const baseUnit = item && isUnitCode(item.unit) ? item.unit : null;
  const inputUnit = unit && baseUnit && compatibleUnits(baseUnit).includes(unit) ? unit : baseUnit;

  function reset() {
    setItemId("");
    setQuantity("");
    setUnit(null);
    setReason("");
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ScaleIcon /> Ajukan koreksi
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ajukan koreksi stok</DialogTitle>
            <DialogDescription>
              Untuk selisih yang bukan dari transaksi tercatat. Stok berubah setelah disetujui Manager
              (bukan oleh pengaju). Salah input transaksi diperbaiki dengan tombol Reversal di mutasi.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <ItemPicker items={items} value={itemId} onChange={(id) => { setItemId(id); setUnit(null); }} />
            <div className="grid grid-cols-2 gap-2">
              {(["in", "out"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={direction === d}
                  onClick={() => setDirection(d)}
                  className={cn(
                    "rounded-xl border py-2.5 text-sm font-medium",
                    direction === d ? "border-neutral-950 bg-neutral-950 text-white" : "hover:border-foreground",
                  )}
                >
                  {d === "in" ? "Tambah (+)" : "Kurangi (−)"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="adj-qty">Jumlah</Label>
                <Input id="adj-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="adj-unit">Satuan</Label>
                <NativeSelect id="adj-unit" value={inputUnit ?? ""} onChange={(e) => setUnit(e.target.value as UnitCode)} disabled={!baseUnit} className="w-full">
                  {(baseUnit ? compatibleUnits(baseUnit) : []).map((u) => (
                    <NativeSelectOption key={u} value={u}>{u}</NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="adj-reason">Alasan</Label>
              <Textarea id="adj-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="mis. selisih timbangan, barang ditemukan" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button
              disabled={pending || !item || !quantity.trim() || reason.trim().length < 5}
              onClick={() =>
                run(
                  () => requestAdjustmentAction({ itemId, direction, quantity, unit: inputUnit, reason }),
                  () => {
                    setOpen(false);
                    reset();
                  },
                )
              }
            >
              {pending ? <Loader2Icon className="animate-spin" /> : null} Ajukan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
