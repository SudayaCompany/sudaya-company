// Geofence absensi (PRD §13). Modul murni: dipakai server sebagai sumber
// kebenaran. Browser hanya mengirim koordinat + akurasi mentah; jarak dan
// keputusan selalu dihitung ulang di sini.
//
// Keterbatasan (didokumentasikan, bukan diklaim teratasi): koordinat dari
// browser bisa dipalsukan (mock location / emulator / DevTools). Geofence
// adalah salah satu sinyal, bukan bukti kehadiran yang anti-fraud sempurna.

import { z } from "zod";

/** Radius rata-rata bumi (IUGG), meter. */
const EARTH_RADIUS_METER = 6_371_008.8;

export type LatLng = { latitude: number; longitude: number };

/** Jarak great-circle (Haversine), meter. */
export function haversineMeters(a: LatLng, b: LatLng) {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METER * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Posisi dari Geolocation API browser (data mentah, belum dipercaya). */
export const positionInput = z.object(
  {
    latitude: z.number({ error: "Lokasi tidak valid." }).min(-90).max(90),
    longitude: z.number({ error: "Lokasi tidak valid." }).min(-180).max(180),
    /** Radius akurasi 68% yang dilaporkan perangkat (meter). */
    accuracy: z.number({ error: "Akurasi GPS tidak valid." }).positive().max(100_000),
    /** Umur fix GPS menurut perangkat (ms) — menolak posisi cache lama. */
    ageMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  },
  { error: "Lokasi GPS wajib dikirim. Aktifkan GPS lalu coba lagi." },
);
export type PositionInput = z.infer<typeof positionInput>;

/** Fix GPS lebih tua dari ini dianggap cache, bukan posisi saat ini. */
export const MAX_POSITION_AGE_MS = 2 * 60 * 1000;

export type GeofenceTarget = {
  latitude: number | null;
  longitude: number | null;
  radiusMeter: number;
};

export type GeofenceDecision =
  | { ok: true; distanceMeter: number | null; mode: "outlet" | "outside_duty" }
  | {
      ok: false;
      reason: "no_outlet_coordinates" | "stale_position" | "accuracy_too_low" | "outside_radius";
      message: string;
      distanceMeter: number | null;
    };

/**
 * Keputusan geofence:
 * 1. Posisi harus segar (bukan cache lama).
 * 2. Akurasi harus ≤ batas (max_gps_accuracy_meter) — tanpa itu jarak tidak bermakna.
 * 3. Tugas luar disetujui & aktif → geofence outlet tidak berlaku (PRD §15),
 *    GPS tetap dicatat.
 * 4. Selain itu outlet wajib punya koordinat dan jarak ≤ radius outlet.
 * Radius tidak pernah dilonggarkan diam-diam; GPS yang tidak memenuhi syarat
 * diarahkan ke koreksi manual yang butuh approval.
 */
export function evaluateGeofence(params: {
  position: PositionInput;
  outlet: GeofenceTarget;
  maxAccuracyMeter: number;
  outsideDuty: boolean;
}): GeofenceDecision {
  const { position, outlet, maxAccuracyMeter, outsideDuty } = params;
  const hasOutlet = outlet.latitude !== null && outlet.longitude !== null;
  const distanceMeter = hasOutlet
    ? haversineMeters(position, { latitude: outlet.latitude!, longitude: outlet.longitude! })
    : null;

  if (position.ageMs > MAX_POSITION_AGE_MS) {
    return { ok: false, reason: "stale_position", distanceMeter, message: "Lokasi GPS sudah lama (cache). Muat ulang lokasi lalu coba lagi." };
  }
  if (position.accuracy > maxAccuracyMeter) {
    return {
      ok: false,
      reason: "accuracy_too_low",
      distanceMeter,
      message: `Akurasi GPS ±${Math.round(position.accuracy)} m melebihi batas ±${maxAccuracyMeter} m. Pindah ke area terbuka / aktifkan lokasi presisi, atau ajukan koreksi absensi.`,
    };
  }
  if (outsideDuty) return { ok: true, distanceMeter, mode: "outside_duty" };
  if (!hasOutlet) {
    return {
      ok: false,
      reason: "no_outlet_coordinates",
      distanceMeter: null,
      message: "Koordinat outlet belum diatur. Hubungi Super Admin untuk konfigurasi lokasi outlet.",
    };
  }
  if (distanceMeter! > outlet.radiusMeter) {
    return {
      ok: false,
      reason: "outside_radius",
      distanceMeter,
      message: `Anda berada di luar area absensi Sudaya Coffee (${Math.round(distanceMeter!)} m dari outlet, batas ${outlet.radiusMeter} m).`,
    };
  }
  return { ok: true, distanceMeter, mode: "outlet" };
}
