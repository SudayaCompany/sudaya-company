// Topik Supabase Realtime (broadcast publik). Payload SELALU kosong: pesan
// hanya sinyal "ada perubahan", lalu client memuat ulang data lewat jalur
// server yang sudah diotorisasi. RLS tabel bisnis tidak perlu dibuka.
//
// Format topik & event juga dipakai fungsi SQL public.expire_pending_orders
// (drizzle/0004_ops_functions.sql) — ubah keduanya bersamaan.

/** Semua perubahan order di satu outlet (KDS, daftar order POS). */
export const outletOrdersTopic = (outletId: string) => `outlet-orders:${outletId}`;

/**
 * Halaman status guest. Diturunkan dari hash token sehingga tidak bisa
 * ditebak dari id/nomor order.
 */
export const guestOrderTopic = (accessTokenHash: string) =>
  `order:${accessTokenHash.slice(0, 40)}`;

export const REALTIME_EVENT = "changed";
