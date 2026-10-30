"use client";

import { Loader2Icon } from "lucide-react";
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
import { revokeEnrollmentAction } from "@/lib/attendance/actions";

/** Admin mencabut registrasi wajah (mis. permintaan subjek data, retensi). */
export function RevokeFaceButton({ employeeId, name }: { employeeId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, run } = useActionToast();
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Cabut registrasi wajah</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cabut registrasi wajah {name}?</DialogTitle>
            <DialogDescription>
              Template di layanan verifikasi dihapus. Karyawan perlu registrasi ulang untuk absensi biometrik.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="revoke-reason">Alasan</Label>
            <Textarea id="revoke-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="mis. permintaan penghapusan data oleh karyawan" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length < 5}
              onClick={() => run(() => revokeEnrollmentAction({ employeeId, reason }), () => setOpen(false))}
            >
              {pending ? <Loader2Icon className="animate-spin" /> : null} Cabut
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
