import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

import * as schema from "./schema";

const databaseUrl = z
  .string({ error: "DATABASE_URL belum di-set (lihat .env.example)" })
  .min(1)
  .parse(process.env.DATABASE_URL);

// Simpan koneksi di globalThis agar hot reload saat dev tidak membuka
// koneksi baru terus-menerus.
const globalForDb = globalThis as unknown as { pgClient?: postgres.Sql };

// prepare: false wajib untuk Supabase transaction pooler (port 6543).
const client = globalForDb.pgClient ?? postgres(databaseUrl, { prepare: false });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

/**
 * Akses DB lewat koneksi Postgres langsung (melewati RLS). Hanya dipakai
 * di server, dan setiap pemanggil wajib cek permission lebih dulu.
 */
export const db = drizzle(client, { schema, casing: "snake_case" });
