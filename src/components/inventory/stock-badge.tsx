import { STOCK_LEVEL_LABELS } from "@/lib/inventory/labels";
import type { StockLevel } from "@/lib/inventory/units";
import { cn } from "@/lib/utils";

// PRD §25 — 🟢 aman, 🟡 menipis, 🔴 habis. Warna selalu disertai teks.
const STYLES: Record<StockLevel, string> = {
  ok: "bg-success/15 text-success",
  low: "bg-warning/25 text-foreground",
  out: "bg-destructive/10 text-destructive",
};
const DOTS: Record<StockLevel, string> = {
  ok: "bg-success",
  low: "bg-warning",
  out: "bg-destructive",
};

export function StockBadge({ level, className }: { level: StockLevel; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        STYLES[level],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOTS[level])} aria-hidden />
      {STOCK_LEVEL_LABELS[level]}
    </span>
  );
}

/** Garis tepi kiri kartu mobile sesuai level stok. */
export const stockAccent = (level: StockLevel) =>
  level === "out" ? "border-l-destructive" : level === "low" ? "border-l-warning" : "border-l-success";
