"use client";

import { Loader2Icon, Undo2Icon } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/hooks/use-action-toast";
import { requestReversalAction } from "@/lib/inventory/actions";

/** Ajukan reversal satu movement (approval Manager; ledger tidak pernah diedit). */
export function ReverseButton({ movementId, summary }: { movementId: string; summary: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, run } = useActionToast();

  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => setOpen(true)} aria-label={`Ajukan reversal ${summary}`}>
        <Undo2Icon /> Reversal
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajukan reversal?</DialogTitle>
            <DialogDescription>
              {summary}. Movement asal tidak diubah; sistem membuat movement kebalikannya setelah
              disetujui Manager.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`reverse-${movementId}`}>Alasan</Label>
            <Textarea
              id={`reverse-${movementId}`}
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              placeholder="mis. salah input jumlah, salah item"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Kembali
            </Button>
            <Button
              disabled={pending || reason.trim().length < 5}
              onClick={() =>
                run(
                  () => requestReversalAction({ movementId, reason }),
                  () => {
                    setOpen(false);
                    setReason("");
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
