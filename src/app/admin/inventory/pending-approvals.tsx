import Link from "next/link";

import { ApprovalButtons } from "@/components/inventory/approval-buttons";
import { Badge } from "@/components/ui/badge";
import type { PendingStockApproval } from "@/lib/inventory/queries";
import { formatQty, formatSignedQty } from "@/lib/inventory/units";

/** Pengajuan koreksi / reversal / opname yang menunggu keputusan. */
export function PendingApprovals({ rows, timezone }: { rows: PendingStockApproval[]; timezone: string }) {
  const time = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const isOpname = r.type === "stock_opname";
        const title = isOpname
          ? "Stock opname"
          : `${r.reversesId ? "Reversal" : "Koreksi"} ${r.itemName}: ${formatSignedQty(r.adjustmentQty ?? "0", r.unit ?? undefined)}`;
        return (
          <li key={r.id} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {title}
                <Badge variant="outline">Menunggu</Badge>
              </p>
              <p className="text-sm text-muted-foreground">{r.reason}</p>
              <p className="text-xs text-muted-foreground">
                {r.requestedByName} · {time.format(r.createdAt)}
                {!isOpname && r.stockQty !== null ? ` · stok sekarang ${formatQty(r.stockQty, r.unit ?? undefined)}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isOpname ? (
                <Link href={`/admin/inventory/opname/${r.referenceId}`} className="text-sm underline underline-offset-2">
                  Lihat detail
                </Link>
              ) : (
                <ApprovalButtons approvalId={r.id} canApprove={r.canApprove} canReject={r.canReject} summary={title + "."} />
              )}
              {!r.canApprove && !r.canReject && !isOpname ? (
                <span className="text-xs text-muted-foreground">Menunggu Manager lain</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
