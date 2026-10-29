"use client";

import { Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { useActionToast } from "@/hooks/use-action-toast";

import {
  assignRoleAction,
  revokeRoleAction,
  setUserActiveAction,
} from "./actions";

export type Option = { id: string; label: string };

const ALL_OUTLETS = "";

export function RoleAssigner({
  userId,
  roles,
  outlets,
}: {
  userId: string;
  roles: Option[];
  outlets: Option[];
}) {
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [outletId, setOutletId] = useState(ALL_OUTLETS);
  const { pending, run } = useActionToast();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect
        size="sm"
        aria-label="Role"
        value={roleId}
        onChange={(e) => setRoleId(e.target.value)}
      >
        {roles.map((role) => (
          <NativeSelectOption key={role.id} value={role.id}>
            {role.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <NativeSelect
        size="sm"
        aria-label="Scope outlet"
        value={outletId}
        onChange={(e) => setOutletId(e.target.value)}
      >
        <NativeSelectOption value={ALL_OUTLETS}>Semua outlet</NativeSelectOption>
        {outlets.map((outlet) => (
          <NativeSelectOption key={outlet.id} value={outlet.id}>
            {outlet.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || !roleId}
        onClick={() =>
          run(() =>
            assignRoleAction({
              userId,
              roleId,
              outletId: outletId === ALL_OUTLETS ? null : outletId,
            }),
          )
        }
      >
        {pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
        Tambah role
      </Button>
    </div>
  );
}

export function RevokeRoleButton({
  userRoleId,
  label,
}: {
  userRoleId: string;
  label: string;
}) {
  const { pending, run } = useActionToast();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => run(() => revokeRoleAction({ userRoleId }))}
      className="rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      aria-label={`Cabut role ${label}`}
    >
      {pending ? <Loader2Icon className="size-3 animate-spin" /> : <XIcon className="size-3" />}
    </button>
  );
}

export function StatusToggle({
  userId,
  isActive,
}: {
  userId: string;
  isActive: boolean;
}) {
  const { pending, run } = useActionToast();
  return (
    <Button
      size="sm"
      variant={isActive ? "destructive" : "outline"}
      disabled={pending}
      onClick={() => run(() => setUserActiveAction({ userId, isActive: !isActive }))}
    >
      {pending ? <Loader2Icon className="animate-spin" /> : null}
      {isActive ? "Nonaktifkan" : "Aktifkan"}
    </Button>
  );
}
