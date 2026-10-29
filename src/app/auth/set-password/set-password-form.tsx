"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import { setPassword, type SetPasswordState } from "./actions";

export function SetPasswordForm() {
  const [state, formAction, pending] = useActionState<SetPasswordState, FormData>(
    setPassword,
    {},
  );

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password baru</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          minLength={12}
          className="h-10"
          required
          autoFocus
        />
        <p className="text-xs text-muted-foreground">Minimal 12 karakter.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Ulangi password</Label>
        <PasswordInput
          id="confirm"
          name="confirm"
          autoComplete="new-password"
          className="h-10"
          required
        />
      </div>
      <Button type="submit" size="lg" className="h-10" disabled={pending}>
        {pending ? <Loader2Icon className="animate-spin" /> : null}
        {pending ? "Menyimpan…" : "Simpan password"}
      </Button>
    </form>
  );
}
