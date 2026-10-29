"use client";

import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
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
import { decideStockApprovalAction } from "@/lib/inventory/actions";

/** Setujui / tolak pengajuan stok (four-eyes dicek ulang di server). */
export function ApprovalButtons({
  approvalId,
  canApprove,
  canReject,
  summary,
}: {
  approvalId: string;
  canApprove: boolean;
  canReject: boolean;
  summary: string;
}) {
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const { pending, run } = useActionToast();
  if (!canApprove && !canReject) return null;

  return (
    <div className="flex gap-2">
      {canReject ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => setMode("reject")}>
          <XIcon /> Tolak
        </Button>
      ) : null}
      {canApprove ? (
        <Button size="sm" disabled={pending} onClick={() => setMode("approve")}>
          <CheckIcon /> Setujui
        </Button>
      ) : null}
      <Dialog open={mode !== null} onOpenChange={(open) => !open && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "approve" ? "Setujui pengajuan?" : "Tolak pengajuan?"}</DialogTitle>
            <DialogDescription>
              {summary}{" "}
              {mode === "approve" ? "Stok langsung diperbarui dan tercatat di ledger." : "Stok tidak berubah."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`note-${approvalId}`}>Catatan (opsional)</Label>
            <Textarea
              id={`note-${approvalId}`}
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)}>
              Kembali
            </Button>
            <Button
              variant={mode === "reject" ? "destructive" : "default"}
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    decideStockApprovalAction({
                      approvalId,
                      approve: mode === "approve",
                      note: note || undefined,
                    }),
                  () => setMode(null),
                )
              }
            >
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              {mode === "approve" ? "Setujui" : "Tolak"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
