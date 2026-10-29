import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Kiosk" };

export default function KioskPage() {
  return (
    <ModulePlaceholder
      title="Sudaya Kiosk"
      description="Mode tablet untuk pemesanan mandiri di outlet."
      features={["Menu layar penuh", "Checkout & pembayaran", "Cetak nomor order"]}
    />
  );
}
