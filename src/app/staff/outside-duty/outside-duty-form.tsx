"use client";

import { CameraIcon, Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requestOutsideDutyAction } from "@/lib/attendance/actions";
import { EVIDENCE_TYPES, MAX_EVIDENCE_BYTES } from "@/lib/inventory/evidence-types";

const field = "flex flex-col gap-1.5";

export function OutsideDutyForm({ today }: { today: string }) {
  const [error, setError] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const photo = data.get("evidence");
    if (photo instanceof File && photo.size > MAX_EVIDENCE_BYTES) {
      setError("Ukuran foto bukti maksimal 3 MB.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await requestOutsideDutyAction(data);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Diajukan.");
      form.reset();
      setPhotoName(null);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border p-4">
      <div className={field}>
        <Label htmlFor="dutyDate">Tanggal</Label>
        <Input id="dutyDate" name="dutyDate" type="date" required min={today} defaultValue={today} className="h-11" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className={field}>
          <Label htmlFor="startTime">Mulai</Label>
          <Input id="startTime" name="startTime" type="time" required className="h-11" />
        </div>
        <div className={field}>
          <Label htmlFor="endTime">Selesai</Label>
          <Input id="endTime" name="endTime" type="time" required className="h-11" />
        </div>
      </div>
      <div className={field}>
        <Label htmlFor="purpose">Tujuan</Label>
        <Input id="purpose" name="purpose" required minLength={3} maxLength={200} placeholder="mis. Belanja bahan ke supplier" className="h-11" />
      </div>
      <div className={field}>
        <Label htmlFor="location">Lokasi tugas</Label>
        <Input id="location" name="location" required minLength={3} maxLength={200} placeholder="Nama tempat / alamat" className="h-11" />
      </div>
      <div className={field}>
        <Label htmlFor="notes">Alasan</Label>
        <Textarea id="notes" name="notes" required minLength={5} maxLength={500} rows={3} />
      </div>
      <div className={field}>
        <Label htmlFor="evidence">Bukti pendukung (opsional)</Label>
        <label htmlFor="evidence" className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground hover:border-foreground">
          <CameraIcon className="size-4" /> {photoName ?? "Foto surat tugas / nota (JPG, PNG, WebP, maks 3 MB)"}
        </label>
        <input
          id="evidence"
          name="evidence"
          type="file"
          accept={EVIDENCE_TYPES.join(",")}
          className="sr-only"
          onChange={(e) => setPhotoName(e.target.files?.[0]?.name ?? null)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Setelah disetujui Manager, geofence outlet tidak berlaku selama jam tugas. Verifikasi wajah & GPS tetap dicatat.
      </p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" size="lg" className="h-12" disabled={pending}>
        {pending ? <Loader2Icon className="animate-spin" /> : null} Ajukan tugas luar
      </Button>
    </form>
  );
}
