import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <ModulePlaceholder
      title="Sudaya Admin"
      description="Back-office untuk Super Admin, Owner, Manager, dan Admin."
      features={[
        "Dashboard penjualan, stok & absensi",
        "Menu, kategori, variant & add-on",
        "Inventory & stock opname",
        "Karyawan, approval & audit log",
      ]}
    />
  );
}
