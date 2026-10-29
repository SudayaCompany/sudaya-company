import "server-only";

import { z } from "zod";

import { createDatabase } from "./client";

const databaseUrl = z
  .string({ error: "DATABASE_URL belum di-set (lihat .env.example)" })
  .min(1)
  .parse(process.env.DATABASE_URL);

// Simpan koneksi di globalThis agar hot reload saat dev tidak membuka
// koneksi baru terus-menerus.
const globalForDb = globalThis as unknown as {
  sudayaDb?: ReturnType<typeof createDatabase>;
};

const connection = globalForDb.sudayaDb ?? createDatabase(databaseUrl);
if (process.env.NODE_ENV !== "production") globalForDb.sudayaDb = connection;

/**
 * Akses DB lewat koneksi Postgres langsung (melewati RLS). Hanya dipakai
 * di server, dan setiap pemanggil wajib cek permission lebih dulu.
 */
export const db = connection.db;
