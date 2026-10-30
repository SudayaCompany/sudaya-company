import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { LogoutButton } from "@/components/logout-button";

/** Kerangka halaman aplikasi staf (mobile-first). */
export function StaffShell({
  title,
  description,
  back = "/staff",
  children,
}: {
  title: string;
  description?: string;
  back?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 py-6">
      <header className="flex items-center justify-between gap-2">
        <Link href={back} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> Kembali
        </Link>
        <Brand className="text-base" />
        <LogoutButton variant="ghost" />
      </header>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}
