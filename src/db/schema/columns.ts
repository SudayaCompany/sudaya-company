import { sql } from "drizzle-orm";
import { bigint, numeric, timestamp, uuid } from "drizzle-orm/pg-core";

// File ini sengaja tidak meng-import tabel apa pun agar tidak ada
// circular import. Helper ber-FK ada di tenancy.ts (tenantColumns)
// dan identity.ts (createdBy).
//
// Builder kolom tidak boleh dipakai bersama antar tabel,
// jadi semua helper berupa fungsi yang membuat builder baru.

export const id = () => uuid().primaryKey().defaultRandom();

/** Waktu selalu dari server database (PRD §14), bukan dari perangkat. */
export const createdAt = () =>
  timestamp({ withTimezone: true }).notNull().defaultNow();

export const timestamps = () => ({
  createdAt: createdAt(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
});

/** Rupiah tanpa desimal. */
export const money = () => bigint({ mode: "number" });

/** Kuantitas stok (gram, ml, pcs) — bisa pecahan. */
export const quantity = () => numeric({ precision: 14, scale: 3 });

/**
 * Harga pokok per satuan stok (mis. Rp 18,5 per ml). Numeric eksak — tidak
 * pernah float — karena satuan dasar kecil membuat harga per unit pecahan.
 */
export const unitCost = () => numeric({ precision: 16, scale: 4 });
