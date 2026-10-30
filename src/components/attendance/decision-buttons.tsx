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
import { decideCorrectionAction, decideOutsideDutyAction } from "@/lib/attendance/actions";

const ACTIONS = {
  outside_duty: decideOutsideDutyAction,
  correction: decideCorrectionAction,
};

/** Setujui / tolak tugas luar atau koreksi absensi (aturan dicek ulang di server). */
export function DecisionButtons({
  kind,
  approvalId,
  canApprove,
  canReject,
  summary,
}: {
  kind: keyof typeof ACTIONS;
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
            <DialogDescription>{summary}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`decision-${approvalId}`}>Catatan (opsional)</Label>
            <Textarea id={`decision-${approvalId}`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
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
                  () => ACTIONS[kind]({ approvalId, approve: mode === "approve", note: note || undefined }),
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
