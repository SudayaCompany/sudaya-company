import { ImageIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRupiah } from "@/lib/format";
import { MOVEMENT_LABELS } from "@/lib/inventory/labels";
import type { MovementRow } from "@/lib/inventory/queries";
import { formatQty, formatSignedQty, qtyFromDb } from "@/lib/inventory/units";
import { cn } from "@/lib/utils";

import { ReverseButton } from "./movement-actions";

function QtyChange({ row }: { row: MovementRow }) {
  const positive = qtyFromDb(row.quantity) > 0n;
  return (
    <span className={cn("font-medium tabular-nums", positive ? "text-success" : "text-destructive")}>
      {formatSignedQty(row.quantity, row.unit)}
    </span>
  );
}

function Status({ row }: { row: MovementRow }) {
  if (row.reversedById) return <Badge variant="outline">Sudah dibalik</Badge>;
  if (row.reversalPending) return <Badge variant="outline">Reversal menunggu</Badge>;
  return null;
}

function EvidenceLink({ row }: { row: MovementRow }) {
  if (!row.hasPhoto) return null;
  return (
    <a
      href={`/admin/inventory/evidence/${row.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2"
    >
      <ImageIcon className="size-3" /> Bukti
    </a>
  );
}

/** Ledger: kartu di mobile (dan panel sempit), tabel di desktop. */
export function MovementList({
  rows,
  timezone,
  canReverse,
  compact = false,
}: {
  rows: MovementRow[];
  timezone: string;
  canReverse: boolean;
  /** Selalu kartu — untuk kolom sempit (dashboard, samping form). */
  compact?: boolean;
}) {
  const time = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  const summary = (r: MovementRow) => `${MOVEMENT_LABELS[r.type]} ${formatSignedQty(r.quantity, r.unit)} ${r.itemName}`;

  return (
    <>
      <ul className={cn("flex flex-col gap-2", !compact && "md:hidden")}>
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-1.5 rounded-xl border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{row.itemName}</p>
                <p className="text-xs text-muted-foreground">
                  {MOVEMENT_LABELS[row.type]} · {time.format(row.createdAt)}
                </p>
              </div>
              <div className="text-right">
                <QtyChange row={row} />
                <p className="text-xs text-muted-foreground">Saldo {formatQty(row.balanceAfter, row.unit)}</p>
              </div>
            </div>
            {row.reason || row.documentRef ? (
              <p className="text-xs text-muted-foreground">
                {[row.documentRef ? `Ref ${row.documentRef}` : null, row.reason].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{row.actorName ?? "Sistem"}</span>
              {row.value !== null ? <span>· {formatRupiah(row.value)}</span> : null}
              <EvidenceLink row={row} />
              <Status row={row} />
              {canReverse && row.canReverse ? (
                <span className="ml-auto">
                  <ReverseButton movementId={row.id} summary={summary(row)} />
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <div className={cn("hidden", !compact && "md:block")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Waktu · oleh</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Jenis</TableHead>
              <TableHead className="text-right">Perubahan</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead className="text-right">Nilai</TableHead>
              <TableHead>Keterangan</TableHead>
              {canReverse ? <TableHead className="text-right">Aksi</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                  {time.format(row.createdAt)}
                  <span className="block text-foreground">{row.actorName ?? "Sistem"}</span>
                </TableCell>
                <TableCell>
                  <p className="font-medium">{row.itemName}</p>
                  <p className="font-mono text-xs text-muted-foreground">{row.itemSku}</p>
                </TableCell>
                <TableCell className="text-sm">
                  <div className="flex flex-col items-start gap-1">
                    {MOVEMENT_LABELS[row.type]}
                    <Status row={row} />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <QtyChange row={row} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatQty(row.balanceAfter, row.unit)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {row.value !== null ? formatRupiah(row.value) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="max-w-64 text-xs text-muted-foreground">
                  <p className="line-clamp-2">
                    {[row.documentRef ? `Ref ${row.documentRef}` : null, row.reason].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <EvidenceLink row={row} />
                </TableCell>
                {canReverse ? (
                  <TableCell className="text-right">
                    {row.canReverse ? <ReverseButton movementId={row.id} summary={summary(row)} /> : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
