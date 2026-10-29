"use client";

import { usePathname, useRouter } from "next/navigation";

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/** Pilih outlet (?outlet=) — hanya tampil bila user punya akses ke >1 outlet. */
export function OutletSelect({
  outlets,
  value,
}: {
  outlets: { id: string; name: string }[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  if (outlets.length < 2) return null;
  return (
    <NativeSelect
      aria-label="Outlet"
      value={value}
      onChange={(e) => router.push(`${pathname}?outlet=${encodeURIComponent(e.target.value)}`)}
      className="w-full sm:w-56"
    >
      {outlets.map((o) => (
        <NativeSelectOption key={o.id} value={o.id}>
          {o.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
