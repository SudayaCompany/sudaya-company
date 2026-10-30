"use client";

import { Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { requestCorrectionAction } from "@/lib/attendance/actions";
import { cn } from "@/lib/utils";

type OpenSession = { id: string; label: string };

/** Pengajuan koreksi absensi; hasilnya selalu berlabel koreksi manual. */
export function CorrectionForm({ openSessions, maxLocal }: { openSessions: OpenSession[]; maxLocal: string }) {
  const [kind, setKind] = useState<"missing_attendance" | "missing_check_out">(
    openSessions.length ? "missing_check_out" : "missing_attendance",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "");
    const input =
      kind === "missing_check_out"
        ? { kind, attendanceId: text("attendanceId"), checkOutAt: text("checkOutAt"), reason: text("reason") }
        : { kind, checkInAt: text("checkInAt"), checkOutAt: text("checkOutAt"), reason: text("reason") };
    setError(null);
    startTransition(async () => {
      const result = await requestCorrectionAction(input);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Diajukan.");
      form.reset();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border p-4">
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-2 text-sm font-medium">Jenis koreksi</legend>
        {(
          [
            ["missing_check_out", "Lupa / gagal check-out"],
            ["missing_attendance", "Absensi tidak tercatat"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            disabled={value === "missing_check_out" && openSessions.length === 0}
            onClick={() => setKind(value)}
            className={cn(
              "rounded-xl border px-2 py-2.5 text-sm font-medium disabled:opacity-50",
              kind === value ? "border-neutral-950 bg-neutral-950 text-white" : "hover:border-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </fieldset>

      {kind === "missing_check_out" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="attendanceId">Sesi yang belum check-out</Label>
          <NativeSelect id="attendanceId" name="attendanceId" className="h-11 w-full" required>
            {openSessions.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>{s.label}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="checkInAt">Jam masuk</Label>
          <Input id="checkInAt" name="checkInAt" type="datetime-local" required max={maxLocal} className="h-11" />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="checkOutAt">Jam pulang</Label>
        <Input id="checkOutAt" name="checkOutAt" type="datetime-local" required max={maxLocal} className="h-11" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reason">Alasan</Label>
        <Textarea
          id="reason"
          name="reason"
          required
          minLength={5}
          maxLength={500}
          rows={3}
          placeholder="mis. layanan verifikasi belum tersedia, GPS tidak akurat di dalam outlet, lupa check-out"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Waktu mengikuti zona waktu outlet. Koreksi disetujui Manager (bukan Anda sendiri) dan tercatat sebagai
        &quot;koreksi manual&quot;, terpisah dari absensi terverifikasi wajah.
      </p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" size="lg" className="h-12" disabled={pending}>
        {pending ? <Loader2Icon className="animate-spin" /> : null} Ajukan koreksi
      </Button>
    </form>
  );
}
