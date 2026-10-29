// IP client hanya dibaca dari header yang DITULIS ULANG oleh proxy tepercaya.
// Header seperti x-forwarded-for bisa dikirim bebas oleh browser/bot bila
// tidak ada proxy di depan aplikasi, jadi tidak dipakai mentah-mentah.
//
// - Vercel (env VERCEL terisi otomatis): x-vercel-forwarded-for / x-real-ip
//   ditimpa edge Vercel, tidak bisa dipalsukan client.
// - Self-host di belakang reverse proxy: set TRUSTED_IP_HEADER ke header yang
//   ditimpa proxy tsb (mis. x-real-ip di Nginx).
// - Selain itu (mis. `next start` lokal): null.

const IP_PATTERN = /^[0-9a-fA-F:.]{2,45}$/;

type HeaderSource = { get(name: string): string | null };
type Env = { VERCEL?: string; TRUSTED_IP_HEADER?: string } & Record<string, string | undefined>;

export function trustedClientIp(headers: HeaderSource, env: Env = process.env): string | null {
  const configured = env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  const names = configured ? [configured] : env.VERCEL ? ["x-vercel-forwarded-for", "x-real-ip"] : [];
  for (const name of names) {
    const raw = headers.get(name);
    if (!raw) continue;
    // Jika proxy menambahkan (bukan menimpa), entri paling kanan yang ditulis proxy.
    const value = raw.split(",").at(-1)!.trim();
    if (IP_PATTERN.test(value)) return value;
  }
  return null;
}
