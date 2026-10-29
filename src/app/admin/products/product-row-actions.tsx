"use client";

import { PencilIcon, PowerIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";

import { ConfirmAction } from "@/components/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useActionToast } from "@/hooks/use-action-toast";

import {
  deleteProductAction,
  setProductActiveAction,
  setProductAvailabilityAction,
} from "./actions";

export function AvailabilitySwitch({
  productId,
  productName,
  outletId,
  isAvailable,
  disabled,
}: {
  productId: string;
  productName: string;
  outletId: string;
  isAvailable: boolean;
  disabled: boolean;
}) {
  const { pending, run } = useActionToast();
  const toggle = (next: boolean) =>
    run(() => setProductAvailabilityAction({ productId, outletId, isAvailable: next }));

  const status = isAvailable ? (
    <Badge variant="secondary" className="bg-success/15 text-success">Tersedia</Badge>
  ) : (
    <Badge variant="destructive">Sold out</Badge>
  );
  if (disabled) return status;

  return (
    <div className="flex items-center gap-2">
      {status}
      {isAvailable ? (
        // Menandai sold out butuh konfirmasi; mengembalikan tersedia langsung.
        <ConfirmAction
          trigger={
            <Button variant="outline" size="xs" disabled={pending} aria-label={`Tandai ${productName} sold out`}>
              Sold out
            </Button>
          }
          title="Tandai sold out?"
          description={`${productName} tidak bisa dipesan customer di outlet ini sampai ditandai tersedia lagi.`}
          confirmLabel="Tandai sold out"
          onConfirm={() => toggle(false)}
        />
      ) : (
        <Button
          variant="outline"
          size="xs"
          disabled={pending}
          aria-label={`Tandai ${productName} tersedia`}
          onClick={() => toggle(true)}
        >
          Tersedia lagi
        </Button>
      )}
    </div>
  );
}

export function ProductRowActions({
  productId,
  productName,
  isActive,
  canEdit,
  canDelete,
}: {
  productId: string;
  productName: string;
  isActive: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const { pending, run } = useActionToast();

  return (
    <div className="flex justify-end gap-1">
      {canEdit ? (
        <Link
          href={`/admin/products/${productId}/edit`}
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          aria-label={`Edit ${productName}`}
        >
          <PencilIcon />
        </Link>
      ) : null}
      {canEdit ? (
        isActive ? (
          <ConfirmAction
            trigger={
              <Button variant="ghost" size="icon-sm" disabled={pending} aria-label={`Nonaktifkan ${productName}`}>
                <PowerIcon />
              </Button>
            }
            title="Nonaktifkan produk?"
            description={`${productName} disembunyikan dari menu customer di semua outlet. Data dan histori tetap tersimpan.`}
            confirmLabel="Nonaktifkan"
            onConfirm={() => run(() => setProductActiveAction({ productId, isActive: false }))}
          />
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label={`Aktifkan ${productName}`}
            onClick={() => run(() => setProductActiveAction({ productId, isActive: true }))}
          >
            <PowerIcon className="text-success" />
          </Button>
        )
      ) : null}
      {canDelete ? (
        <ConfirmAction
          trigger={
            <Button variant="ghost" size="icon-sm" disabled={pending} aria-label={`Hapus ${productName}`}>
              <Trash2Icon className="text-destructive" />
            </Button>
          }
          title="Hapus produk?"
          description={`${productName} dihapus dari daftar menu. Histori transaksi yang memakai produk ini tetap utuh.`}
          confirmLabel="Hapus"
          onConfirm={() => run(() => deleteProductAction(productId))}
        />
      ) : null}
    </div>
  );
}
