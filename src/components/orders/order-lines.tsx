import { formatPriceDelta, formatRupiah } from "@/lib/format";
import type { OrderLineView } from "@/lib/orders/engine";

/** Daftar item order (snapshot harga saat order dibuat). */
export function OrderLines({ lines, total }: { lines: OrderLineView[]; total: number }) {
  return (
    <div className="flex flex-col text-sm">
      <ul className="flex flex-col divide-y">
        {lines.map((line) => (
          <li key={line.id} className="flex gap-3 py-2.5">
            <span className="w-8 font-medium tabular-nums">{line.quantity}×</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{line.productName}</p>
              {line.modifiers.length ? (
                <p className="text-xs text-muted-foreground">
                  {line.modifiers
                    .map((m) => `${m.name}${m.priceDelta ? ` (${formatPriceDelta(m.priceDelta)})` : ""}`)
                    .join(", ")}
                </p>
              ) : null}
              {line.notes ? <p className="text-xs text-muted-foreground italic">“{line.notes}”</p> : null}
            </div>
            <span className="tabular-nums">{formatRupiah(line.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <div className="flex justify-between border-t pt-3 text-base font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatRupiah(total)}</span>
      </div>
    </div>
  );
}
