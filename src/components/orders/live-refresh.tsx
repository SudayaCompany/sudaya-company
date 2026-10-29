"use client";

import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { cn } from "@/lib/utils";

/** Indikator + langganan sinyal realtime untuk halaman staf. */
export function LiveRefresh({ topic, className }: { topic: string; className?: string }) {
  const state = useRealtimeRefresh(topic, 15_000);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)} aria-live="polite">
      <span
        className={cn("size-2 rounded-full", state === "live" ? "bg-success" : "animate-pulse bg-brand")}
        aria-hidden
      />
      {state === "live" ? "Realtime" : state === "polling" ? "Polling" : "Menyambung…"}
    </span>
  );
}
