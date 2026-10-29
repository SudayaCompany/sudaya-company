"use client";

import { Loader2Icon, LogInIcon } from "lucide-react";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { login, type LoginState } from "./actions";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    login,
    {},
  );

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  const emailError = state.fieldErrors?.email;
  const passwordError = state.fieldErrors?.password;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {notice && !state.error ? (
        <p role="status" className="rounded-lg border bg-muted px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          placeholder="nama@sudaya.co"
          defaultValue={state.email}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "email-error" : undefined}
          className="h-10"
          required
          autoFocus
        />
        {emailError ? (
          <p id="email-error" className="text-xs text-destructive">
            {emailError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={passwordError ? "password-error" : undefined}
          className="h-10"
          required
        />
        {passwordError ? (
          <p id="password-error" className="text-xs text-destructive">
            {passwordError}
          </p>
        ) : null}
      </div>

      <Button type="submit" size="lg" className="h-10" disabled={pending}>
        {pending ? <Loader2Icon className="animate-spin" /> : <LogInIcon />}
        {pending ? "Memproses…" : "Masuk"}
      </Button>
    </form>
  );
}
