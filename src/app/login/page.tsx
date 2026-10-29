import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthLayout } from "@/components/auth-layout";
import { LogoutButton } from "@/components/logout-button";
import { Skeleton } from "@/components/ui/skeleton";
import { postLoginPath, safeNextPath } from "@/lib/auth/policy";
import { getCurrentUser, getSessionUserId } from "@/lib/auth/session";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Login" };

const ERROR_NOTICES: Record<string, string> = {
  link: "Link undangan tidak valid atau sudah kedaluwarsa. Minta admin membuat undangan baru.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthLayout>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Masuk ke Sudaya</h1>
        <p className="text-sm text-muted-foreground">
          Untuk barista, kasir, admin, dan manajemen.
        </p>
      </div>
      <Suspense fallback={<LoginSkeleton />}>
        <LoginGate searchParams={searchParams} />
      </Suspense>
    </AuthLayout>
  );
}

async function LoginGate({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;

  if (await getSessionUserId()) {
    const user = await getCurrentUser();
    const destination = user?.isActive ? postLoginPath(user, next) : null;
    if (destination) redirect(destination);

    // Sudah login di Supabase tapi tidak bisa masuk — tampilkan alasan,
    // jangan redirect (mencegah loop).
    const reason = !user
      ? "Akun ini belum terdaftar sebagai staf Sudaya."
      : !user.isActive
        ? "Akun Anda dinonaktifkan. Hubungi admin."
        : "Akun Anda belum memiliki akses. Hubungi admin.";
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="rounded-lg border bg-muted px-3 py-2 text-sm">
          {reason}
        </p>
        <LogoutButton variant="default" label="Keluar & ganti akun" />
      </div>
    );
  }

  return (
    <LoginForm
      next={safeNextPath(next) ?? undefined}
      notice={error ? ERROR_NOTICES[error] : undefined}
    />
  );
}

function LoginSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy>
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-10" />
    </div>
  );
}
