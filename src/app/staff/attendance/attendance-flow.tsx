"use client";

import {
  CameraIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleIcon,
  Loader2Icon,
  LocateFixedIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { checkInAction, checkLocationAction, checkOutAction, startFaceSessionAction } from "@/lib/attendance/actions";
import { FACE_CLIENTS } from "@/lib/attendance/face-client";
import type { PositionInput } from "@/lib/attendance/geo";
import { cn } from "@/lib/utils";

// PRD §16: absensi wajib online — status koneksi dari browser.
function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
const useOnline = () =>
  useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

type CameraState = "idle" | "requesting" | "ready" | "denied" | "unavailable" | "insecure" | "error";
type LocationState =
  | { status: "idle" | "locating" }
  | { status: "denied" | "unavailable" | "insecure" | "error"; message: string }
  | {
      status: "checked";
      position: PositionInput;
      ok: boolean;
      message: string | null;
      distanceMeter: number | null;
      radiusMeter: number;
      maxAccuracyMeter: number;
    };

const CAMERA_MESSAGES: Partial<Record<CameraState, string>> = {
  denied: "Izin kamera ditolak. Buka pengaturan situs di browser → izinkan Kamera, lalu coba lagi.",
  unavailable: "Kamera tidak ditemukan di perangkat ini.",
  insecure: "Kamera hanya tersedia di koneksi aman (HTTPS).",
  error: "Kamera tidak dapat dibuka. Tutup aplikasi lain yang memakai kamera lalu coba lagi.",
};

function Step({ state, title, children }: { state: "todo" | "ok" | "fail" | "busy"; title: string; children?: React.ReactNode }) {
  const Icon = state === "ok" ? CheckCircle2Icon : state === "fail" ? CircleAlertIcon : state === "busy" ? Loader2Icon : CircleIcon;
  return (
    <li className="flex gap-3">
      <Icon
        className={cn(
          "mt-0.5 size-5 shrink-0",
          state === "ok" && "text-success",
          state === "fail" && "text-destructive",
          state === "busy" && "animate-spin text-muted-foreground",
          state === "todo" && "text-muted-foreground",
        )}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

export function AttendanceFlow({
  mode,
  providerReady,
  providerMessage,
  enrolled,
  outsideDuty,
}: {
  mode: "check_in" | "check_out";
  providerReady: boolean;
  providerMessage: string | null;
  enrolled: boolean;
  outsideDuty: boolean;
}) {
  const online = useOnline();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<CameraState>("idle");
  const [location, setLocation] = useState<LocationState>({ status: "idle" });
  const [submitting, startSubmit] = useTransition();

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  async function openCamera() {
    if (!window.isSecureContext) return setCamera("insecure");
    if (!navigator.mediaDevices?.getUserMedia) return setCamera("unavailable");
    setCamera("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCamera("ready");
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setCamera(
        name === "NotAllowedError" || name === "SecurityError"
          ? "denied"
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "unavailable"
            : "error",
      );
    }
  }

  function locate() {
    if (!window.isSecureContext) {
      return setLocation({ status: "insecure", message: "GPS hanya tersedia di koneksi aman (HTTPS)." });
    }
    if (!navigator.geolocation) {
      return setLocation({ status: "unavailable", message: "Perangkat tidak mendukung GPS / lokasi." });
    }
    setLocation({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const position: PositionInput = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          ageMs: Math.max(0, Math.round(Date.now() - pos.timestamp)),
        };
        const result = await checkLocationAction({ position });
        if (!result.ok) return setLocation({ status: "error", message: result.error });
        const data = result.data!;
        setLocation({
          status: "checked",
          position,
          ok: data.ok,
          message: data.ok ? null : data.message,
          distanceMeter: data.distanceMeter,
          radiusMeter: data.radiusMeter,
          maxAccuracyMeter: data.maxAccuracyMeter,
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setLocation({ status: "denied", message: "Izin lokasi ditolak. Aktifkan GPS dan izinkan Lokasi untuk situs ini, lalu coba lagi." });
        } else if (error.code === error.TIMEOUT) {
          setLocation({ status: "error", message: "GPS tidak merespons. Pastikan GPS aktif lalu coba lagi." });
        } else {
          setLocation({ status: "unavailable", message: "Lokasi tidak tersedia. Aktifkan GPS lalu coba lagi." });
        }
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  const locationOk = location.status === "checked" && location.ok;
  const canSubmit = online && providerReady && enrolled && camera === "ready" && locationOk && !submitting;

  function submit() {
    if (location.status !== "checked") return;
    startSubmit(async () => {
      const started = await startFaceSessionAction({ purpose: mode });
      if (!started.ok) {
        toast.error(started.error);
        return;
      }
      const session = started.data!;
      const client = FACE_CLIENTS[session.provider];
      if (!client || !videoRef.current) {
        toast.error("SDK layanan verifikasi wajah belum tersedia di aplikasi.");
        return;
      }
      try {
        await client(session, videoRef.current);
      } catch {
        toast.error("Verifikasi wajah dibatalkan atau gagal. Coba lagi.");
        return;
      }
      const action = mode === "check_in" ? checkInAction : checkOutAction;
      const result = await action({ sessionId: session.sessionId, position: location.position });
      if (result.ok) toast.success(result.message ?? "Tersimpan.");
      else toast.error(result.error);
    });
  }

  const title = mode === "check_in" ? "Check-in" : "Check-out";

  return (
    <section className="flex flex-col gap-4 rounded-2xl border p-4" aria-label={`Alur ${title}`}>
      <ol className="flex flex-col gap-4">
        <Step state={online ? "ok" : "fail"} title={online ? "Terhubung ke internet" : "Tidak ada koneksi internet"}>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {online ? <WifiIcon className="size-3.5" /> : <WifiOffIcon className="size-3.5" />}
            Absensi wajib online; tidak ada absensi offline.
          </p>
        </Step>

        <Step
          state={camera === "ready" ? "ok" : camera === "requesting" ? "busy" : CAMERA_MESSAGES[camera] ? "fail" : "todo"}
          title="Kamera depan"
        >
          <div className={cn("relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-muted", camera !== "ready" && "hidden")}>
            <video ref={videoRef} autoPlay playsInline muted className="size-full -scale-x-100 object-cover" />
          </div>
          {CAMERA_MESSAGES[camera] ? <p className="text-sm text-destructive">{CAMERA_MESSAGES[camera]}</p> : null}
          <p className="text-xs text-muted-foreground">
            Pratinjau hanya tampil di perangkat Anda. Sudaya tidak menyimpan foto wajah.
          </p>
          {camera !== "ready" ? (
            <Button type="button" variant="outline" onClick={openCamera} disabled={camera === "requesting"} className="h-11 w-fit">
              <CameraIcon /> {camera === "idle" ? "Buka kamera" : "Coba lagi"}
            </Button>
          ) : null}
        </Step>

        <Step
          state={
            location.status === "checked"
              ? location.ok
                ? "ok"
                : "fail"
              : location.status === "locating"
                ? "busy"
                : location.status === "idle"
                  ? "todo"
                  : "fail"
          }
          title={outsideDuty ? "Lokasi (tugas luar disetujui)" : "Lokasi di area outlet"}
        >
          {location.status === "checked" ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Akurasi GPS</dt>
              <dd className={cn("tabular-nums", location.position.accuracy > location.maxAccuracyMeter && "font-medium text-destructive")}>
                ±{Math.round(location.position.accuracy)} m (batas ±{location.maxAccuracyMeter} m)
              </dd>
              <dt className="text-muted-foreground">Jarak ke outlet</dt>
              <dd className="tabular-nums">
                {location.distanceMeter === null ? "—" : `${location.distanceMeter.toFixed(1)} m`}
                {outsideDuty ? "" : ` (batas ${location.radiusMeter} m)`}
              </dd>
            </dl>
          ) : null}
          {"message" in location && location.message ? <p className="text-sm text-destructive">{location.message}</p> : null}
          <Button type="button" variant="outline" onClick={locate} disabled={location.status === "locating"} className="h-11 w-fit">
            <LocateFixedIcon /> {location.status === "idle" ? "Ambil lokasi" : "Ambil ulang lokasi"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Jarak dihitung ulang di server. GPS ponsel bisa meleset beberapa meter; jika tidak memenuhi syarat, ajukan koreksi absensi.
          </p>
        </Step>

        <Step state={providerReady && enrolled ? "ok" : "fail"} title="Verifikasi wajah (liveness + pencocokan)">
          <p className={cn("text-sm", providerReady && enrolled ? "text-muted-foreground" : "text-destructive")}>
            {!providerReady
              ? providerMessage
              : !enrolled
                ? "Wajah Anda belum terdaftar. Lakukan registrasi wajah terlebih dahulu."
                : "Dilakukan oleh layanan verifikasi saat Anda menekan tombol di bawah."}
          </p>
        </Step>
      </ol>

      <div className="sticky bottom-0 -mx-4 -mb-4 rounded-b-2xl border-t bg-background/95 p-4 backdrop-blur">
        <Button type="button" size="lg" className="h-12 w-full text-base" disabled={!canSubmit} onClick={submit}>
          {submitting ? <Loader2Icon className="animate-spin" /> : null} {title} sekarang
        </Button>
      </div>
    </section>
  );
}
