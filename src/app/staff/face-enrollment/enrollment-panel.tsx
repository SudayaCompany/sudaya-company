"use client";

import { Loader2Icon, ScanFaceIcon, ShieldCheckIcon } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmAction } from "@/components/confirm-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  completeEnrollmentAction,
  giveConsentAction,
  revokeEnrollmentAction,
  startFaceSessionAction,
} from "@/lib/attendance/actions";
import { FACE_CLIENTS } from "@/lib/attendance/face-client";

/** Persetujuan → kamera → enrollment lewat SDK provider; serta pencabutan. */
export function EnrollmentPanel({
  noticeVersion,
  providerReady,
  providerMessage,
  consented,
  enrolled,
}: {
  noticeVersion: string;
  providerReady: boolean;
  providerMessage: string | null;
  consented: boolean;
  enrolled: boolean;
}) {
  const [agree, setAgree] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const videoRef = useRef<HTMLVideoElement>(null);

  function consentAndEnroll() {
    startTransition(async () => {
      if (!consented) {
        const consent = await giveConsentAction({ noticeVersion, agree });
        if (!consent.ok) return void toast.error(consent.error);
      }
      const started = await startFaceSessionAction({ purpose: "enrollment" });
      if (!started.ok) return void toast.error(started.error);
      const client = FACE_CLIENTS[started.data!.provider];
      if (!client || !videoRef.current) {
        return void toast.error("SDK layanan verifikasi wajah belum tersedia di aplikasi.");
      }
      try {
        await client(started.data!, videoRef.current);
      } catch {
        return void toast.error("Pengambilan wajah dibatalkan atau gagal. Coba lagi.");
      }
      const done = await completeEnrollmentAction({ sessionId: started.data!.sessionId });
      if (done.ok) toast.success(done.message ?? "Registrasi berhasil.");
      else toast.error(done.error);
    });
  }

  function revoke() {
    startTransition(async () => {
      const result = await revokeEnrollmentAction({ reason });
      if (result.ok) {
        toast.success(result.message ?? "Dicabut.");
        setReason("");
      } else toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {enrolled ? (
        <p className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 p-3 text-sm font-medium">
          <ShieldCheckIcon className="size-4 text-success" /> Wajah Anda sudah terdaftar.
        </p>
      ) : !providerReady ? (
        <div className="flex flex-col gap-1 rounded-xl border border-warning/60 bg-warning/10 p-3 text-sm">
          <p className="font-medium">{providerMessage}</p>
          <p className="text-muted-foreground">
            Registrasi wajah belum bisa dilakukan, dan persetujuan belum diminta sampai layanan verifikasi yang disetujui
            Sudaya tersedia. Absensi Anda tetap bisa dicatat lewat koreksi manual.
          </p>
        </div>
      ) : (
        <section className="flex flex-col gap-3 rounded-2xl border p-4">
          {!consented ? (
            <label className="flex items-start gap-3 text-sm">
              <Checkbox checked={agree} onCheckedChange={(v) => setAgree(Boolean(v))} className="mt-0.5" />
              <span>
                Saya telah membaca pemberitahuan privasi (versi {noticeVersion}) dan memberikan persetujuan eksplisit atas
                pemrosesan data wajah saya untuk verifikasi absensi.
              </span>
            </label>
          ) : (
            <p className="text-sm text-muted-foreground">Persetujuan Anda sudah tercatat.</p>
          )}
          <video ref={videoRef} autoPlay playsInline muted className="hidden aspect-[4/3] w-full rounded-xl bg-muted" />
          <Button size="lg" className="h-12" disabled={pending || (!consented && !agree)} onClick={consentAndEnroll}>
            {pending ? <Loader2Icon className="animate-spin" /> : <ScanFaceIcon />} Mulai registrasi wajah
          </Button>
          <p className="text-xs text-muted-foreground">
            Ikuti instruksi di layar: wajah menghadap kamera, cahaya cukup, tanpa masker/kacamata gelap.
          </p>
        </section>
      )}

      {enrolled || consented ? (
        <section className="flex flex-col gap-2 rounded-2xl border p-4">
          <h2 className="text-sm font-medium">Tarik persetujuan & hapus registrasi</h2>
          <p className="text-xs text-muted-foreground">
            Registrasi wajah dicabut dan template di layanan verifikasi dihapus. Absensi tetap bisa lewat koreksi manual.
          </p>
          <Label htmlFor="revoke-reason" className="sr-only">Alasan</Label>
          <Textarea id="revoke-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Alasan (min. 5 karakter)" />
          <ConfirmAction
            trigger={
              <Button variant="outline" disabled={pending || reason.trim().length < 5} className="w-fit">
                Tarik persetujuan
              </Button>
            }
            title="Tarik persetujuan biometrik?"
            description="Registrasi wajah dicabut dan Anda perlu registrasi ulang untuk absensi biometrik."
            confirmLabel="Tarik persetujuan"
            onConfirm={revoke}
          />
        </section>
      ) : null}
    </div>
  );
}
