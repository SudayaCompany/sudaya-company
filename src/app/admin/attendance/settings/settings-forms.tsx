"use client";

import { Loader2Icon, LocateFixedIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActionToast } from "@/hooks/use-action-toast";
import { updateAttendanceSettingsAction, updateOutletGeofenceAction } from "@/lib/attendance/actions";

const field = "flex flex-col gap-1.5";
const toNumber = (value: string) => (value.trim() === "" ? null : Number(value.replace(",", ".")));

/** Koordinat & radius satu outlet. Tidak ada koordinat bawaan/contoh. */
export function GeofenceForm({
  outlet,
}: {
  outlet: { id: string; name: string; code: string; latitude: number | null; longitude: number | null; radiusMeter: number };
}) {
  const [latitude, setLatitude] = useState(outlet.latitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(outlet.longitude?.toString() ?? "");
  const [radius, setRadius] = useState(String(outlet.radiusMeter));
  const [fix, setFix] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const { pending, run } = useActionToast();

  function useCurrent() {
    if (!navigator.geolocation) return setFix("Perangkat tidak mendukung GPS.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(7));
        setLongitude(pos.coords.longitude.toFixed(7));
        setFix(`Diambil dari perangkat ini, akurasi ±${Math.round(pos.coords.accuracy)} m. Ambil di titik absensi, ulangi bila akurasi buruk.`);
        setLocating(false);
      },
      () => {
        setFix("Lokasi tidak bisa diambil (izin ditolak / GPS mati).");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(() =>
          updateOutletGeofenceAction({
            outletId: outlet.id,
            latitude: toNumber(latitude),
            longitude: toNumber(longitude),
            radiusMeter: Number(radius),
          }),
        );
      }}
    >
      <p className="font-medium">{outlet.name} <span className="font-mono text-xs text-muted-foreground">{outlet.code}</span></p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={field}>
          <Label htmlFor={`lat-${outlet.id}`}>Latitude</Label>
          <Input id={`lat-${outlet.id}`} inputMode="decimal" value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="Belum diatur" />
        </div>
        <div className={field}>
          <Label htmlFor={`lng-${outlet.id}`}>Longitude</Label>
          <Input id={`lng-${outlet.id}`} inputMode="decimal" value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="Belum diatur" />
        </div>
        <div className={field}>
          <Label htmlFor={`radius-${outlet.id}`}>Radius (meter)</Label>
          <Input id={`radius-${outlet.id}`} type="number" min={1} max={1000} value={radius} onChange={(e) => setRadius(e.target.value)} />
        </div>
      </div>
      {fix ? <p className="text-xs text-muted-foreground">{fix}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={useCurrent} disabled={locating}>
          {locating ? <Loader2Icon className="animate-spin" /> : <LocateFixedIcon />} Gunakan lokasi perangkat
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : null} Simpan
        </Button>
      </div>
    </form>
  );
}

export function AttendanceSettingsForm({
  settings,
}: {
  settings: {
    maxGpsAccuracyMeter: number;
    faceMatchThreshold: number | null;
    livenessThreshold: number | null;
    verificationProvider: string | null;
    policyVersion: string;
  };
}) {
  const { pending, run } = useActionToast();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const text = (name: string) => String(data.get(name) ?? "");
        run(() =>
          updateAttendanceSettingsAction({
            maxGpsAccuracyMeter: Number(text("maxGpsAccuracyMeter")),
            faceMatchThreshold: toNumber(text("faceMatchThreshold")),
            livenessThreshold: toNumber(text("livenessThreshold")),
            verificationProvider: text("verificationProvider"),
            policyVersion: text("policyVersion"),
          }),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={field}>
          <Label htmlFor="maxGpsAccuracyMeter">Akurasi GPS maksimum (meter)</Label>
          <Input id="maxGpsAccuracyMeter" name="maxGpsAccuracyMeter" type="number" min={1} max={1000} required defaultValue={settings.maxGpsAccuracyMeter} />
          <p className="text-xs text-muted-foreground">Fix GPS dengan akurasi lebih buruk ditolak dan diarahkan ke koreksi manual.</p>
        </div>
        <div className={field}>
          <Label htmlFor="policyVersion">Versi kebijakan absensi</Label>
          <Input id="policyVersion" name="policyVersion" required maxLength={40} defaultValue={settings.policyVersion} />
        </div>
        <div className={field}>
          <Label htmlFor="verificationProvider">Provider verifikasi (kode)</Label>
          <Input id="verificationProvider" name="verificationProvider" maxLength={60} defaultValue={settings.verificationProvider ?? ""} placeholder="Belum ditetapkan" />
          <p className="text-xs text-muted-foreground">Isi hanya setelah provider disetujui (DPIA & perjanjian pemrosesan data).</p>
        </div>
        <div />
        <div className={field}>
          <Label htmlFor="livenessThreshold">Ambang liveness</Label>
          <Input id="livenessThreshold" name="livenessThreshold" inputMode="decimal" defaultValue={settings.livenessThreshold ?? ""} placeholder="Belum ditetapkan" />
        </div>
        <div className={field}>
          <Label htmlFor="faceMatchThreshold">Ambang kecocokan wajah</Label>
          <Input id="faceMatchThreshold" name="faceMatchThreshold" inputMode="decimal" defaultValue={settings.faceMatchThreshold ?? ""} placeholder="Belum ditetapkan" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Ambang mengikuti skala skor provider dan ditetapkan dari dokumentasi provider + uji lapangan, bukan angka bawaan.
        Selama kosong, verifikasi biometrik tidak dapat dipakai.
      </p>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? <Loader2Icon className="animate-spin" /> : null} Simpan pengaturan
      </Button>
    </form>
  );
}
