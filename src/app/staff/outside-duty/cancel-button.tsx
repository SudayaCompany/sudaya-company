"use client";

import { ConfirmAction } from "@/components/confirm-action";
import { Button } from "@/components/ui/button";
import { useActionToast } from "@/hooks/use-action-toast";
import { cancelCorrectionAction, cancelOutsideDutyAction } from "@/lib/attendance/actions";

const ACTIONS = { outside_duty: cancelOutsideDutyAction, correction: cancelCorrectionAction };

/** Batalkan pengajuan milik sendiri yang masih menunggu. */
export function CancelButton({ kind, id }: { kind: keyof typeof ACTIONS; id: string }) {
  const { pending, run } = useActionToast();
  return (
    <ConfirmAction
      trigger={
        <Button variant="ghost" size="xs" disabled={pending} className="w-fit">
          Batalkan pengajuan
        </Button>
      }
      title="Batalkan pengajuan?"
      description="Pengajuan yang dibatalkan tidak bisa diproses lagi."
      confirmLabel="Batalkan"
      onConfirm={() => run(() => ACTIONS[kind]({ id }))}
    />
  );
}
