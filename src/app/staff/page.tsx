import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Staff" };

export default function StaffPage() {
  return (
    <ModulePlaceholder
      title="Sudaya Staff"
      description="Aplikasi barista & kasir (PWA)."
      features={[
        "Absensi wajah + GPS geofence",
        "POS & konfirmasi pembayaran cash",
        "Opening / closing kas",
        "Stok, waste & stock opname",
      ]}
    />
  );
}
