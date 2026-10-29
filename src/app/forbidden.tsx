import { ShieldXIcon } from "lucide-react";
import Link from "next/link";

import { LogoutButton } from "@/components/logout-button";
import { buttonVariants } from "@/components/ui/button";

export default function Forbidden() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldXIcon className="size-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">403</p>
        <h1 className="text-2xl font-semibold tracking-tight">Access Denied</h1>
        <p className="text-sm text-muted-foreground">
          Akun Anda tidak memiliki izin untuk membuka halaman ini. Hubungi admin
          jika Anda merasa ini keliru.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {/* /login mengarahkan user yang sudah login ke halaman sesuai aksesnya. */}
        <Link href="/login" className={buttonVariants({ size: "sm" })}>
          Ke halaman saya
        </Link>
        <LogoutButton label="Ganti akun" />
      </div>
    </main>
  );
}
