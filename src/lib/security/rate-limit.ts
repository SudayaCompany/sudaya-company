// Rate limit fixed-window di Postgres: satu statement atomik (upsert) per
// request, konsisten di semua instance serverless tanpa layanan tambahan.
// Key di-hash sehingga tabel tidak menyimpan IP / id perangkat mentah.

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/client";

export type RateLimitRule = {
  /** mis. `checkout:ip:203.0.113.5` — di-hash sebelum disimpan. */
  key: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number; key: string };

export const rateLimitKeyHash = (key: string) => createHash("sha256").update(key).digest("hex");

/**
 * Menaikkan semua counter sekaligus lalu menilai hasilnya. Setiap percobaan
 * dihitung (termasuk yang akhirnya ditolak validasi) agar spam payload rusak
 * juga tertahan.
 */
export async function consumeRateLimits(
  db: DbExecutor,
  rules: RateLimitRule[],
): Promise<RateLimitResult> {
  const unique = [...new Map(rules.map((r) => [rateLimitKeyHash(r.key), r])).entries()];
  if (unique.length === 0) return { ok: true };

  const values = sql.join(
    unique.map(([hash, rule]) => sql`(${hash}, ${rule.windowSeconds}::int)`),
    sql`, `,
  );
  const rows = (await db.execute(sql`
    insert into rate_limit_counters as c (key, window_start, count, expires_at)
    select v.key, now(), 1, now() + make_interval(secs => v.window_seconds)
    from (values ${values}) as v(key, window_seconds)
    on conflict (key) do update set
      window_start = case when c.expires_at <= now() then now() else c.window_start end,
      count = case when c.expires_at <= now() then 1 else c.count + 1 end,
      expires_at = case when c.expires_at <= now() then excluded.expires_at else c.expires_at end
    returning c.key, c.count,
      greatest(1, ceil(extract(epoch from c.expires_at - now())))::int as retry_after
  `)) as unknown as { key: string; count: number; retry_after: number }[];

  let blocked: { retryAfterSeconds: number; key: string } | null = null;
  for (const row of rows) {
    const rule = unique.find(([hash]) => hash === row.key)?.[1];
    if (!rule || Number(row.count) <= rule.limit) continue;
    const retryAfterSeconds = Number(row.retry_after);
    if (!blocked || retryAfterSeconds > blocked.retryAfterSeconds) {
      blocked = { retryAfterSeconds, key: rule.key };
    }
  }
  return blocked ? { ok: false, ...blocked } : { ok: true };
}
