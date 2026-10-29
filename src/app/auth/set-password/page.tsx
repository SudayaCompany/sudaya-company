import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthLayout } from "@/components/auth-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAuth } from "@/lib/auth/session";

import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Buat password" };

export default function SetPasswordPage() {
  return (
    <AuthLayout>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <SetPasswordContent />
      </Suspense>
    </AuthLayout>
  );
}

async function SetPasswordContent() {
  const user = await requireAuth();
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Buat password</h1>
        <p className="text-sm text-muted-foreground">
          Halo {user.fullName}, buat password untuk akun Sudaya Anda.
        </p>
      </div>
      <SetPasswordForm />
    </>
  );
}
