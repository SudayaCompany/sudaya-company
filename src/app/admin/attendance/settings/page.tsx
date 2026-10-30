import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { loadSettings } from "@/lib/attendance/engine";
import { getFaceProvider, providerState } from "@/lib/attendance/face-provider";
import { geofenceOutlets } from "@/lib/attendance/queries";
import { requirePermission } from "@/lib/auth/session";

import { AttendanceSettingsForm, GeofenceForm } from "./settings-forms";

export const metadata: Metadata = { title: "Pengaturan absensi" };

export default function AttendanceSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  const actor = await requirePermission("settings.manage", { outletId: null });
  const [outlets, settings] = await Promise.all([geofenceOutlets(db, actor), loadSettings(db, actor.company.id)]);
  const provider = getFaceProvider();
  const state = providerState(provider, {
    verificationProvider: settings.verificationProvider,
    liveness: settings.livenessThreshold,
    match: settings.faceMatchThreshold,
  });

  return (
    <>
      <PageHeader title="Pengaturan absensi" description="Geofence outlet, batas akurasi GPS, dan layanan verifikasi wajah" />

      <Card>
        <CardHeader><CardTitle>Status layanan verifikasi wajah</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className={state.ready ? "font-medium text-success" : "font-medium"}>
            {state.ready ? "Siap dipakai" : state.message}
          </p>
          <p className="text-muted-foreground">
            Adapter terpasang: {provider ? provider.id : "tidak ada"} · Provider disetujui di pengaturan:{" "}
            {settings.verificationProvider ?? "belum ditetapkan"}
          </p>
          <p className="text-muted-foreground">
            Selama belum siap, absensi tidak pernah ditandai terverifikasi biometrik; kehadiran dicatat lewat koreksi manual
            yang disetujui Manager dan diberi label terpisah di laporan.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Lokasi & radius outlet</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Radius default 5 m. GPS ponsel umumnya meleset beberapa meter (lebih buruk di dalam ruangan), jadi akurasi aktual
            ditampilkan ke karyawan. Radius tidak dilonggarkan otomatis; absensi yang gagal karena GPS diajukan sebagai koreksi.
            GPS browser dapat dipalsukan (mock location), sehingga geofence bukan jaminan anti-kecurangan.
          </p>
          {outlets.map((outlet) => (
            <GeofenceForm key={outlet.id} outlet={outlet} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Parameter absensi</CardTitle></CardHeader>
        <CardContent>
          <AttendanceSettingsForm settings={settings} />
        </CardContent>
      </Card>
    </>
  );
}
