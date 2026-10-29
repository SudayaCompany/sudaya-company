"use client";

import { CopyIcon, Loader2Icon, UserPlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { useActionToast } from "@/hooks/use-action-toast";

import { inviteStaffAction } from "./actions";
import type { Option } from "./user-controls";

export function InviteStaffForm({
  roles,
  outlets,
}: {
  roles: Option[];
  outlets: Option[];
}) {
  const { pending, run } = useActionToast();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const outletId = String(data.get("outletId") ?? "");
    setInviteUrl(null);
    run(
      () =>
        inviteStaffAction({
          email: data.get("email"),
          fullName: data.get("fullName"),
          roleId: data.get("roleId"),
          outletId: outletId === "" ? null : outletId,
        }),
      (result) => {
        setInviteUrl(result.data?.inviteUrl ?? null);
        form.reset();
      },
    );
  }

  async function copy() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.success("Link undangan disalin.");
    } catch {
      toast.error("Gagal menyalin. Salin manual dari kolom di atas.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto] lg:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-name">Nama lengkap</Label>
          <Input id="invite-name" name="fullName" required minLength={2} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input id="invite-email" name="email" type="email" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <NativeSelect id="invite-role" name="roleId" required className="w-full">
            {roles.map((role) => (
              <NativeSelectOption key={role.id} value={role.id}>
                {role.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-outlet">Outlet</Label>
          <NativeSelect id="invite-outlet" name="outletId" className="w-full">
            <NativeSelectOption value="">Semua outlet</NativeSelectOption>
            {outlets.map((outlet) => (
              <NativeSelectOption key={outlet.id} value={outlet.id}>
                {outlet.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : <UserPlusIcon />}
          Undang
        </Button>
      </form>

      {inviteUrl ? (
        <div className="flex flex-col gap-2 rounded-lg border border-brand/40 bg-brand/5 p-3 text-sm">
          <p className="font-medium">Link undangan (hanya ditampilkan sekali)</p>
          <p className="text-xs text-muted-foreground">
            Kirim langsung ke staf lewat kanal pribadi. Link berlaku sesuai
            pengaturan masa berlaku email OTP di Supabase dan hanya bisa dipakai sekali.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={inviteUrl} aria-label="Link undangan" className="font-mono text-xs" />
            <Button type="button" variant="outline" onClick={copy}>
              <CopyIcon /> Salin
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
