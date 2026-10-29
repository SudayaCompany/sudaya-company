import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url().refine((url) => new URL(url).pathname === "/", {
    error:
      "NEXT_PUBLIC_SUPABASE_URL harus berupa Project URL tanpa path (mis. https://xxxx.supabase.co, bukan .../rest/v1/).",
  }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

/**
 * Env yang aman dipakai di browser. Setiap variabel ditulis literal
 * agar Next.js bisa meng-inline-nya ke bundle client.
 */
export function getPublicEnv() {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
