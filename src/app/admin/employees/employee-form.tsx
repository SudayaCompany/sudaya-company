"use client";

import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { createEmployeeAction, updateEmployeeAction } from "@/lib/attendance/actions";

export type EmployeeFormValues = {
  id: string;
  employeeCode: string;
  fullName: string;
  phone: string | null;
  position: string | null;
  outletId: string;
  joinedAt: string | null;
  userId: string | null;
  isActive: boolean;
};

const field = "flex flex-col gap-1.5";

/** Buat / ubah karyawan. Akun login dibuat di Pengguna lalu ditautkan di sini. */
export function EmployeeForm({
  outlets,
  accounts,
  employee,
}: {
  outlets: { id: string; name: string }[];
  accounts: { id: string; fullName: string; email: string | null }[];
  employee?: EmployeeFormValues;
}) {
  const router = useRouter();
  const [isActive, setIsActive] = useState(employee?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim() || undefined;
    const values = {
      fullName: text("fullName"),
      phone: text("phone"),
      position: text("position"),
      outletId: text("outletId"),
      joinedAt: text("joinedAt"),
      userId: text("userId"),
    };
    setError(null);
    startTransition(async () => {
      if (employee) {
        const result = await updateEmployeeAction({ employeeId: employee.id, ...values, isActive });
        if (!result.ok) return void setError(result.error);
        toast.success(result.message ?? "Tersimpan.");
        router.push(`/admin/employees/${employee.id}`);
      } else {
        const result = await createEmployeeAction({ employeeCode: text("employeeCode"), ...values });
        if (!result.ok) return void setError(result.error);
        toast.success(result.message ?? "Tersimpan.");
        router.push(`/admin/employees/${result.data!.id}`);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className={field}>
          <Label htmlFor="employeeCode">Employee ID</Label>
          {employee ? (
            <Input id="employeeCode" value={employee.employeeCode} disabled className="font-mono" />
          ) : (
            <Input id="employeeCode" name="employeeCode" required minLength={2} maxLength={20} className="font-mono uppercase" placeholder="mis. SDY-0012" />
          )}
        </div>
        <div className={field}>
          <Label htmlFor="fullName">Nama lengkap</Label>
          <Input id="fullName" name="fullName" required minLength={2} maxLength={80} defaultValue={employee?.fullName} />
        </div>
        <div className={field}>
          <Label htmlFor="phone">Nomor telepon</Label>
          <Input id="phone" name="phone" type="tel" inputMode="tel" maxLength={20} defaultValue={employee?.phone ?? ""} />
        </div>
        <div className={field}>
          <Label htmlFor="position">Jabatan</Label>
          <Input id="position" name="position" maxLength={60} defaultValue={employee?.position ?? ""} placeholder="mis. Barista" />
        </div>
        <div className={field}>
          <Label htmlFor="outletId">Outlet absensi</Label>
          <NativeSelect id="outletId" name="outletId" defaultValue={employee?.outletId ?? outlets[0]?.id} className="w-full" required>
            {outlets.map((o) => (
              <NativeSelectOption key={o.id} value={o.id}>{o.name}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className={field}>
          <Label htmlFor="joinedAt">Tanggal bergabung</Label>
          <Input id="joinedAt" name="joinedAt" type="date" defaultValue={employee?.joinedAt ?? ""} />
        </div>
        <div className={`${field} sm:col-span-2`}>
          <Label htmlFor="userId">Akun login</Label>
          <NativeSelect id="userId" name="userId" defaultValue={employee?.userId ?? ""} className="w-full">
            <NativeSelectOption value="">Belum punya akun</NativeSelectOption>
            {accounts.map((a) => (
              <NativeSelectOption key={a.id} value={a.id}>
                {a.fullName}{a.email ? ` — ${a.email}` : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            Akun & role dibuat/diundang di <Link href="/admin/users" className="underline">Pengguna</Link>. Password tidak disimpan di data karyawan.
          </p>
        </div>
      </div>
      {employee ? (
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={isActive} onCheckedChange={setIsActive} /> Karyawan aktif
          {!isActive && employee.isActive ? (
            <span className="text-xs text-muted-foreground">— registrasi wajah akan dicabut (kebijakan retensi)</span>
          ) : null}
        </label>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : null} Simpan
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Batal</Button>
      </div>
    </form>
  );
}
