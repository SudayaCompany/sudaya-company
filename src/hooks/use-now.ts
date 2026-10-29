"use client";

import { useSyncExternalStore } from "react";

// Jam bersama untuk timer (satu interval untuk semua kartu). Server &
// render pertama mendapat 0 agar tidak terjadi hydration mismatch.
let now = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Waktu sekarang (ms), diperbarui tiap detik; 0 sebelum hydrate. */
export function useNow() {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => 0,
  );
}
