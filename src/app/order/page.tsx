import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Order" };

export default function OrderPage() {
  return (
    <ModulePlaceholder
      title="Sudaya Order"
      description="Pesan lewat QR meja, QR counter, atau link — tanpa install aplikasi, tanpa wajib login."
      features={[
        "Menu, variant & add-on",
        "Cart & checkout (Cash / QRIS)",
        "Nomor order & status pesanan realtime",
      ]}
    />
  );
}
