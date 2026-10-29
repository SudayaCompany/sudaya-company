"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useNow } from "@/hooks/use-now";

/**
 * Hitung mundur batas bayar. Penentu sebenarnya waktu database (pg_cron &
 * cek saat kasir konfirmasi); ini hanya tampilan.
 */
export function PaymentDeadline({ expiresAt, label }: { expiresAt: string; label: string }) {
  const now = useNow();
  const router = useRouter();
  const remaining = now ? Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000)) : null;
  const expired = remaining === 0;

  useEffect(() => {
    // Beri jeda agar pembatalan otomatis (pg_cron per menit) sempat berjalan.
    if (!expired) return;
    const timer = setTimeout(() => router.refresh(), 5_000);
    return () => clearTimeout(timer);
  }, [expired, router]);

  return (
    <p className="text-sm" aria-live="polite">
      {expired ? (
        <span className="font-semibold text-destructive">Batas waktu pembayaran habis.</span>
      ) : (
        <>
          Bayar sebelum <span className="font-semibold">{label}</span>
          {remaining !== null ? (
            <span className="text-muted-foreground">
              {" "}
              (sisa {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")})
            </span>
          ) : null}
        </>
      )}
    </p>
  );
}
