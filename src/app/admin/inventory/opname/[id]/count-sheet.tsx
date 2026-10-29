"use client";

import { Loader2Icon, SaveIcon, SearchIcon, SendIcon, XIcon } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmAction } from "@/components/confirm-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cancelOpnameAction, saveOpnameCountsAction, submitOpnameAction } from "@/lib/inventory/actions";
import { formatQty, formatSignedQty, parseQty, qtyFromDb, qtyToString } from "@/lib/inventory/units";
import { cn } from "@/lib/utils";

export type CountRow = {
  itemId: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  systemQty: string;
  currentQty: string;
  actualQty: string | null;
  reason: string | null;
};

type Draft = { actual: string; reason: string };

const CHUNK = 500;

/** Input hitung fisik. Variance di layar hanya pratinjau; server menghitung ulang. */
export function CountSheet({ opnameId, rows }: { opnameId: string; rows: CountRow[] }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.itemId,
        { actual: r.actualQty === null ? "" : qtyToString(qtyFromDb(r.actualQty)), reason: r.reason ?? "" },
      ]),
    ),
  );
  const [query, setQuery] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [pending, startTransition] = useTransition();

  const variance = (row: CountRow) => {
    const actual = parseQty(drafts[row.itemId]?.actual ?? "");
    return actual === null ? null : actual - qtyFromDb(row.systemQty);
  };
  const counted = rows.filter((r) => (drafts[r.itemId]?.actual ?? "").trim() !== "").length;
  const missingReason = rows.filter((r) => {
    const v = variance(r);
    return v !== null && v !== 0n && (drafts[r.itemId]?.reason.trim().length ?? 0) < 3;
  }).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyPending && (drafts[r.itemId]?.actual ?? "").trim() !== "") return false;
      return !q || r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q);
    });
  }, [rows, query, onlyPending, drafts]);

  const set = (itemId: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [itemId]: { ...d[itemId], ...patch } }));

  async function save() {
    const counts = rows.map((r) => ({
      itemId: r.itemId,
      actualQty: drafts[r.itemId]?.actual.trim() || null,
      reason: drafts[r.itemId]?.reason.trim() || undefined,
    }));
    for (let i = 0; i < counts.length; i += CHUNK) {
      const result = await saveOpnameCountsAction({ opnameId, counts: counts.slice(i, i + CHUNK) });
      if (!result.ok) return result;
    }
    return { ok: true as const };
  }

  const run = (submit: boolean) =>
    startTransition(async () => {
      const saved = await save();
      if (!saved.ok) {
        toast.error(saved.error);
        return;
      }
      if (!submit) {
        toast.success("Hitungan tersimpan.");
        return;
      }
      const result = await submitOpnameAction({ opnameId });
      if (result.ok) toast.success(result.message ?? "Diajukan.");
      else toast.error(result.error);
    });

  const varianceText = (row: CountRow) => {
    const v = variance(row);
    if (v === null) return <span className="text-muted-foreground">—</span>;
    return (
      <span className={cn("font-medium tabular-nums", v === 0n ? "text-success" : v > 0n ? "text-foreground" : "text-destructive")}>
        {v === 0n ? "Sesuai" : formatSignedQty(v, row.unit)}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari item" className="h-11 pl-8" aria-label="Cari item opname" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} className="size-4" />
          Hanya yang belum dihitung
        </label>
      </div>

      <ul className="flex flex-col gap-2">
        {visible.map((row) => {
          const v = variance(row);
          const needsReason = v !== null && v !== 0n;
          const moved = qtyFromDb(row.currentQty) !== qtyFromDb(row.systemQty);
          return (
            <li key={row.itemId} className="grid gap-2 rounded-xl border p-3 md:grid-cols-[minmax(0,1.4fr)_8rem_9rem_7rem_minmax(0,1.2fr)] md:items-center">
              <div className="min-w-0">
                <p className="truncate font-medium">{row.name}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {row.sku}
                  {row.category ? ` · ${row.category}` : ""}
                </p>
              </div>
              <div className="flex items-baseline justify-between gap-2 md:block">
                <span className="text-xs text-muted-foreground md:hidden">Sistem (snapshot)</span>
                <p className="tabular-nums">{formatQty(row.systemQty, row.unit)}</p>
                {moved ? (
                  <p className="text-xs text-muted-foreground">sekarang {formatQty(row.currentQty, row.unit)}</p>
                ) : null}
              </div>
              <label className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-xs text-muted-foreground md:sr-only">Fisik ({row.unit})</span>
                <Input
                  inputMode="decimal"
                  value={drafts[row.itemId]?.actual ?? ""}
                  onChange={(e) => set(row.itemId, { actual: e.target.value })}
                  placeholder={row.unit}
                  className="h-11 text-base"
                  aria-label={`Jumlah fisik ${row.name}`}
                />
              </label>
              <div className="flex items-baseline justify-between gap-2 md:block">
                <span className="text-xs text-muted-foreground md:hidden">Selisih</span>
                {varianceText(row)}
              </div>
              <Input
                value={drafts[row.itemId]?.reason ?? ""}
                onChange={(e) => set(row.itemId, { reason: e.target.value })}
                maxLength={300}
                placeholder={needsReason ? "Alasan selisih (wajib)" : "Alasan (jika selisih)"}
                aria-label={`Alasan selisih ${row.name}`}
                aria-invalid={needsReason && (drafts[row.itemId]?.reason.trim().length ?? 0) < 3}
                className={cn("h-11", !needsReason && "hidden md:block")}
              />
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between md:-mx-0 md:rounded-xl md:border md:px-4">
        <p className="text-sm text-muted-foreground">
          {counted}/{rows.length} dihitung
          {missingReason ? ` · ${missingReason} selisih belum ada alasan` : ""}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <ConfirmAction
            trigger={
              <Button variant="ghost" disabled={pending} className="col-span-2 sm:col-span-1">
                <XIcon /> Batalkan sesi
              </Button>
            }
            title="Batalkan sesi opname?"
            description="Hitungan dibuang dan stok tidak berubah."
            confirmLabel="Batalkan sesi"
            onConfirm={() =>
              startTransition(async () => {
                const result = await cancelOpnameAction({ opnameId });
                if (result.ok) toast.success(result.message ?? "Dibatalkan.");
                else toast.error(result.error);
              })
            }
          />
          <Button variant="outline" disabled={pending} onClick={() => run(false)} className="h-11">
            {pending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />} Simpan
          </Button>
          <Button disabled={pending || counted === 0 || missingReason > 0} onClick={() => run(true)} className="h-11">
            <SendIcon /> Ajukan
          </Button>
        </div>
      </div>
    </div>
  );
}
