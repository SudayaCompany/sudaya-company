import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Barista Display" };

export default function KdsPage() {
  return (
    <ModulePlaceholder
      title="Barista Display"
      description="Satu antrean untuk semua channel, urut FIFO berdasarkan waktu bayar."
      features={["New", "Preparing", "Ready", "Completed"]}
    />
  );
}
