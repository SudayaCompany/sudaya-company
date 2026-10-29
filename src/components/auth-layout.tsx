import { Brand } from "@/components/brand";

/** Layout halaman auth: panel brand hitam (desktop) + area form putih. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh flex-1 lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-neutral-950 p-10 text-white lg:flex">
        <Brand tone="light" className="text-xl" />
        <div className="relative z-10 flex max-w-md flex-col gap-4">
          <span className="h-1 w-12 rounded-full bg-brand" aria-hidden />
          <p className="text-3xl leading-tight font-semibold tracking-tight">
            Satu sistem untuk seluruh operasional outlet.
          </p>
          <p className="text-sm text-neutral-400">
            Absensi, POS, antrean barista, stok, dan laporan dalam satu data.
          </p>
        </div>
        <p className="text-xs text-neutral-500">Sudaya Company</p>
        <div
          className="pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full bg-brand/10 blur-3xl"
          aria-hidden
        />
      </aside>

      <main className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <Brand className="text-2xl lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
