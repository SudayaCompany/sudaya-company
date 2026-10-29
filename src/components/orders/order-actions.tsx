"use client";

import { BanknoteIcon, CheckIcon, Loader2Icon, PrinterIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/hooks/use-action-toast";
import { formatRupiah } from "@/lib/format";
import {
  cancelOrderAction,
  confirmCashAction,
  decideCancellationAction,
} from "@/lib/orders/actions";

export type OrderActionFlags = {
  canConfirmCash: boolean;
  canCancel: boolean;
  canDecide: boolean;
};

/** Aksi kasir/manager pada detail order. Semua dicek ulang di server. */
export function OrderActions({
  orderId,
  total,
  status,
  paymentStatus,
  pendingApproval,
  flags,
  receiptHref,
}: {
  orderId: string;
  total: number;
  status: string;
  paymentStatus: string;
  pendingApproval: { id: string; reason: string; requestedByName: string } | null;
  flags: OrderActionFlags;
  receiptHref: string;
}) {
  const unpaid = status === "pending_payment";
  const terminal = ["completed", "cancelled", "refunded"].includes(status);

  return (
    <div className="flex flex-col gap-3">
      {unpaid && flags.canConfirmCash ? <ConfirmCash orderId={orderId} total={total} /> : null}

      {pendingApproval ? (
        <div className="flex flex-col gap-2 rounded-lg border border-brand/40 bg-brand/5 p-3 text-sm">
          <p className="font-medium">Pengajuan pembatalan menunggu persetujuan</p>
          <p className="text-muted-foreground">
            “{pendingApproval.reason}” — {pendingApproval.requestedByName}
          </p>
          {flags.canDecide ? <DecideApproval approvalId={pendingApproval.id} /> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link href={receiptHref} target="_blank" className={buttonVariants({ variant: "outline" })}>
          <PrinterIcon /> Cetak struk
        </Link>
        {!terminal && !pendingApproval && flags.canCancel ? (
          <CancelOrder orderId={orderId} paid={paymentStatus === "paid"} />
        ) : null}
      </div>
    </div>
  );
}

function ConfirmCash({ orderId, total }: { orderId: string; total: number }) {
  const [tendered, setTendered] = useState(String(total));
  const { pending, run } = useActionToast();
  const amount = Number(tendered);
  const valid = Number.isInteger(amount) && amount >= total;

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => confirmCashAction({ orderId, tenderedAmount: amount }));
      }}
    >
      <Label htmlFor="tendered">Uang tunai diterima</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="tendered"
          type="number"
          inputMode="numeric"
          min={total}
          value={tendered}
          onChange={(e) => setTendered(e.target.value)}
          className="h-10 max-w-40 tabular-nums"
        />
        {[total, 50_000, 100_000].filter((v, i, arr) => v >= total && arr.indexOf(v) === i).map((v) => (
          <Button key={v} type="button" variant="outline" className="h-10" onClick={() => setTendered(String(v))}>
            {v === total ? "Uang pas" : formatRupiah(v)}
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Kembalian: <span className="font-medium text-foreground tabular-nums">{valid ? formatRupiah(amount - total) : "—"}</span>
      </p>
      <Button type="submit" className="h-11 bg-success text-success-foreground hover:bg-success/90" disabled={!valid || pending}>
        {pending ? <Loader2Icon className="animate-spin" /> : <BanknoteIcon />}
        Konfirmasi pembayaran {formatRupiah(total)}
      </Button>
    </form>
  );
}

function CancelOrder({ orderId, paid }: { orderId: string; paid: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, run } = useActionToast();

  return (
    <>
      <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
        <XIcon /> {paid ? "Ajukan pembatalan" : "Batalkan pesanan"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{paid ? "Ajukan pembatalan?" : "Batalkan pesanan?"}</DialogTitle>
            <DialogDescription>
              {paid
                ? "Pesanan sudah dibayar. Pembatalan butuh persetujuan Manager dan tidak otomatis mengembalikan uang — refund diproses terpisah."
                : "Pesanan belum dibayar dan akan dibatalkan."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cancel-reason">Alasan</Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              placeholder="mis. salah input, customer batal, order duplikat"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Kembali</Button>
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length < 3}
              onClick={() => run(() => cancelOrderAction({ orderId, reason }), () => setOpen(false))}
            >
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              {paid ? "Ajukan" : "Batalkan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DecideApproval({ approvalId }: { approvalId: string }) {
  const { pending, run } = useActionToast();
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        className="bg-success text-success-foreground hover:bg-success/90"
        disabled={pending}
        onClick={() => run(() => decideCancellationAction({ approvalId, approve: true }))}
      >
        <CheckIcon /> Setujui
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => run(() => decideCancellationAction({ approvalId, approve: false }))}
      >
        Tolak
      </Button>
    </div>
  );
}
