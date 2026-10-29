# Sudaya Company

Platform operasional Sudaya Coffee: absensi, POS, self-order, antrean barista,
stok, dan laporan. Spesifikasi lengkap ada di [docs/PRD.txt](docs/PRD.txt).

## Stack

Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind v4 · shadcn/ui ·
Supabase (Postgres, Auth, Storage, Realtime) · Drizzle ORM · Vercel.

## Interface

Semua interface berada dalam satu app Next.js:

| Path     | Interface        | Pengguna                  | Login   |
| -------- | ---------------- | ------------------------- | ------- |
| `/order` | Sudaya Order     | Customer (PWA)            | Opsional |
| `/kiosk` | Sudaya Kiosk     | Customer di outlet        | Tidak   |
| `/staff` | Sudaya Staff     | Barista, kasir (PWA)      | Wajib   |
| `/kds`   | Barista Display  | Barista                   | Wajib   |
| `/admin` | Sudaya Admin     | Super Admin, Owner, Admin | Wajib   |

## Setup

1. Buat project di [Supabase](https://supabase.com).
2. `cp .env.example .env.local`, lalu isi nilainya.
3. `npm install`
4. `npm run db:migrate` untuk menerapkan migrasi di `drizzle/` ke database.
5. `npm run dev`, lalu buka http://localhost:3000

## Script

| Script                | Fungsi                                          |
| --------------------- | ----------------------------------------------- |
| `npm run dev`         | Dev server                                      |
| `npm run build`       | Build produksi                                  |
| `npm run lint`        | ESLint                                          |
| `npm run typecheck`   | Cek tipe TypeScript                             |
| `npm run db:generate` | Buat file migrasi dari perubahan `src/db/schema` |
| `npm run db:migrate`  | Terapkan migrasi ke database                    |
| `npm run db:studio`   | Buka Drizzle Studio                             |

## Struktur

```
src/
  app/            Route per interface (order, kiosk, staff, kds, admin, login)
  components/ui/  Komponen shadcn/ui
  db/
    schema/       Skema Drizzle per domain (tenancy, identity, orders, ...)
    index.ts      Drizzle client (server-only)
  lib/supabase/   Supabase client: server, browser, proxy (refresh session)
  proxy.ts        Next.js Proxy (dulu middleware): refresh session + guard area internal
drizzle/          File migrasi SQL hasil generate
```

## Prinsip keamanan data

- **RLS aktif di semua tabel tanpa policy.** Akibatnya publishable key tidak bisa
  membaca atau menulis tabel lewat REST API Supabase. Semua akses data lewat
  Drizzle di server, dan setiap Server Action atau Route Handler wajib cek
  permission (RBAC).
- Waktu transaksi dan absensi selalu diambil dari `now()` database, bukan dari
  jam perangkat.
- Stok memakai ledger (`inventory_transactions`). `inventory_items.stock_qty`
  hanya cache saldo dan harus diubah dalam transaksi DB yang sama.
- Data wajah disimpan di provider face recognition. Database hanya menyimpan ID
  referensi dan waktu consent.
