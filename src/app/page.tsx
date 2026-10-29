import Link from "next/link";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const interfaces = [
  {
    href: "/order",
    title: "Sudaya Order",
    description: "Customer — menu, QR order, checkout, status pesanan.",
  },
  {
    href: "/kiosk",
    title: "Sudaya Kiosk",
    description: "Tablet pemesanan mandiri di outlet.",
  },
  {
    href: "/staff",
    title: "Sudaya Staff",
    description: "Barista & kasir — absensi, POS, antrean, stok.",
  },
  {
    href: "/kds",
    title: "Barista Display",
    description: "Antrean produksi New → Preparing → Ready → Completed.",
  },
  {
    href: "/admin",
    title: "Sudaya Admin",
    description: "Dashboard, menu, inventory, karyawan, approval, laporan.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-brand">Sudaya Company</p>
        <h1 className="text-4xl font-semibold tracking-tight">Sudaya Coffee</h1>
        <p className="text-muted-foreground">
          Satu Sistem — Satu Data — Satu Antrean — Satu Kontrol Operasional.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {interfaces.map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="h-full transition-colors hover:border-brand">
              <CardHeader>
                <CardTitle>{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
