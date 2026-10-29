"use client";

import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

/** Memuat ulang halaman status saat ada sinyal realtime (atau polling). */
export function LiveStatus({ topic, active }: { topic: string; active: boolean }) {
  const state = useRealtimeRefresh(active ? topic : null, 10_000);
  if (!active) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
      <span
        className={state === "live" ? "size-2 rounded-full bg-success" : "size-2 animate-pulse rounded-full bg-brand"}
        aria-hidden
      />
      {state === "live" ? "Diperbarui otomatis" : "Memeriksa pembaruan…"}
    </p>
  );
}
