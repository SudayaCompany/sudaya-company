import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Bisa koneksi utama atau transaksi yang sedang berjalan. */
export type DbExecutor = Database | Transaction;

/**
 * Membuat koneksi Drizzle. Dipakai oleh app (src/db/index.ts) dan script
 * CLI/test — script tidak bisa meng-import src/db/index.ts karena modul
 * itu bertanda server-only.
 */
export function createDatabase(
  url: string,
  options: postgres.Options<Record<string, never>> = {},
) {
  // prepare: false wajib untuk Supabase transaction pooler (port 6543).
  const client = postgres(url, { prepare: false, onnotice: () => {}, ...options });
  const db: Database = drizzle(client, { schema, casing: "snake_case" });
  return { db, client };
}
