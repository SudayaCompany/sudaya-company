"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/auth/errors";

/** Menjalankan Server Action dalam transition lalu menampilkan hasilnya via toast. */
export function useActionToast() {
  const [pending, startTransition] = useTransition();

  function run<T>(
    action: () => Promise<ActionResult<T>>,
    onSuccess?: (result: Extract<ActionResult<T>, { ok: true }>) => void,
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(result.message ?? "Tersimpan.");
        onSuccess?.(result);
      } else {
        toast.error(result.error);
      }
    });
  }

  return { pending, run };
}
