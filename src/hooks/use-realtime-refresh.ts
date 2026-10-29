"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { REALTIME_EVENT } from "@/lib/orders/realtime";
import { createClient } from "@/lib/supabase/client";

export type RealtimeState = "connecting" | "live" | "polling";

/**
 * Berlangganan sinyal broadcast (tanpa data) lalu memuat ulang komponen
 * server lewat router.refresh() — data tetap diambil lewat jalur yang
 * diotorisasi server. Jika Realtime gagal tersambung, beralih ke polling.
 */
export function useRealtimeRefresh(topic: string | null, pollMs = 15_000): RealtimeState {
  const router = useRouter();
  const [state, setState] = useState<RealtimeState>("connecting");

  useEffect(() => {
    if (!topic) return;
    const supabase = createClient();
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      // Gabungkan beberapa sinyal beruntun menjadi satu refresh.
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), 250);
    };
    const startPolling = () => {
      if (pollTimer) return;
      setState("polling");
      pollTimer = setInterval(refresh, pollMs);
    };
    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };

    const fallback = setTimeout(startPolling, 8_000);
    const channel = supabase
      .channel(topic, { config: { private: false } })
      .on("broadcast", { event: REALTIME_EVENT }, refresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(fallback);
          stopPolling();
          setState("live");
          // Tangkap perubahan yang terjadi selama menyambung.
          refresh();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          startPolling();
        }
      });

    return () => {
      clearTimeout(fallback);
      if (refreshTimer) clearTimeout(refreshTimer);
      stopPolling();
      void supabase.removeChannel(channel);
    };
  }, [topic, pollMs, router]);

  return topic ? state : "polling";
}
