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

Butuh Node.js 22 (lihat `.nvmrc`) dan project [Supabase](https://supabase.com).

1. Copy `.env.example` → `.env.local`
2. Isi `DATABASE_URL` (lihat [Setup database](#setup-database)) beserta key Supabase lainnya
3. `npm install`
4. `npm run db:migrate`
5. `npm run db:seed`: membuat Sudaya Company, Sudaya Coffee, Outlet 01, serta role dan permission
6. `npm run admin:bootstrap`: menyiapkan Super Admin pertama (lihat [Super Admin pertama](#super-admin-pertama))
7. `npm run storage:setup`: menyiapkan bucket foto menu (lihat [Menu & foto](#menu--foto-epic-02))
8. `npm run dev`, lalu buka http://localhost:3000/login

## Setup database

`DATABASE_URL` adalah satu-satunya variabel koneksi Postgres. Variabel ini
dipakai oleh app (`src/db`) dan oleh `drizzle-kit`. `drizzle.config.ts`
memuat `.env.local` sendiri, karena `drizzle-kit` tidak membacanya otomatis
seperti Next.js.

Cara mengambil connection string:

1. Buka Supabase Dashboard → tombol **Connect** → tab **Connection string**.
2. Pilih **Session pooler**. Bentuknya:
   `postgresql://postgres.<project-ref>:<password>@aws-<n>-<region>.pooler.supabase.com:5432/postgres`
3. Ganti `[YOUR-PASSWORD]` dengan password database. Kalau lupa, reset di
   Project Settings → Database. Karakter khusus seperti `@ : / ? #` harus
   di-URL-encode.
4. Tempel ke `.env.local` sebagai `DATABASE_URL=...`, lalu jalankan
   `npm run db:migrate`.

> **Kenapa bukan Direct connection?** Host `db.<project-ref>.supabase.co`
> hanya bisa diakses lewat IPv6. Di jaringan tanpa IPv6, koneksinya gagal
> dengan `ENETUNREACH`/`ENOTFOUND`. Session pooler mendukung IPv4 dan aman
> untuk migrasi. Transaction pooler (port 6543) cocok untuk runtime di Vercel,
> tapi sebaiknya tidak dipakai untuk migrasi.

`npm run db:migrate` hanya menerapkan migrasi yang belum pernah dijalankan.
Riwayatnya dicatat di tabel `drizzle.__drizzle_migrations`. Perintah ini tidak
me-reset atau men-drop database.

Keamanan:
- `DATABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` hanya untuk server. Jangan
  beri prefix `NEXT_PUBLIC_`.
- `.env.local` sudah di-ignore git. Jangan commit file itu.

## Seed data awal

`npm run db:seed` aman dijalankan berulang kali. Seeder hanya menjalankan
`INSERT ... ON CONFLICT DO NOTHING` di dalam satu transaksi, tanpa UPDATE atau
DELETE. Akibatnya:

- Pengaturan outlet yang sudah diubah, seperti radius absensi atau koordinat, tidak direset.
- Role `super_admin` selalu mendapat semua permission, termasuk permission baru.
- Role lain hanya mendapat permission default saat role itu pertama kali dibuat.
  Permission yang sengaja dicabut admin tidak dikembalikan oleh seeder.
- Alamat dan koordinat outlet dibiarkan kosong. Isi lewat database atau menu
  pengaturan setelah modulnya ada. Radius absensi default 5 meter.

Katalog role dan permission ada di [src/lib/auth/rbac.ts](src/lib/auth/rbac.ts).

## Super Admin pertama

```bash
npm run admin:bootstrap
# atau tanpa prompt email/nama:
npm run admin:bootstrap -- --email=nama@domain.com --name="Nama Lengkap"
```

1. Script mencari akun di Supabase Auth berdasarkan email.
2. Kalau akun belum ada, script meminta password di terminal. Input tidak
   ditampilkan, minimal 12 karakter, dan hanya disimpan oleh Supabase Auth.
   Cara lain: buat user dulu di Supabase Dashboard → Authentication → Add user.
3. Akun dihubungkan ke Sudaya Company dengan role `super_admin`, lalu
   dicatat di audit log.

Script menolak berjalan kalau company sudah punya Super Admin lain. Admin
berikutnya ditambahkan lewat `/admin/users`. Script juga butuh Node 22 dan
`SUPABASE_SERVICE_ROLE_KEY`.

## Auth & otorisasi

- **Login:** email dan password lewat Supabase Auth (Server Action
  [src/app/login/actions.ts](src/app/login/actions.ts)). Akun yang tidak
  terdaftar sebagai staf atau berstatus nonaktif langsung di-logout.
- **Session:** cookie Supabase di-refresh oleh [src/proxy.ts](src/proxy.ts).
  Setiap request juga mengecek `auth.sessions`, jadi logout langsung membuat
  cookie lama tidak berlaku.
- **Otorisasi:** DAL di [src/lib/auth/session.ts](src/lib/auth/session.ts)
  (`requireAuth`, `requirePermission`, `requireAnyPermission`,
  `requireActionUser`). Proxy hanya pengecekan awal. Setiap halaman dan Server
  Action mengecek ulang di server.
- **Scope:** role bisa berlaku di semua outlet (`outlet_id = null`) atau satu
  outlet. Data company lain selalu diperlakukan tidak ada.
- **Anti privilege escalation:** actor hanya bisa memberi role atau mengelola
  akun yang permission-nya juga ia miliki pada scope tersebut. Actor tidak bisa
  mengubah akses akunnya sendiri. Super Admin terakhir tidak bisa dicabut.
- **Staf baru:** diundang lewat `/admin/users`. Admin membagikan link undangan,
  lalu staf membuat password sendiri di `/auth/set-password`.
- **403:** halaman tanpa izin memanggil `forbidden()` dan menampilkan
  [src/app/forbidden.tsx](src/app/forbidden.tsx).

## Menu & foto (Epic 02)

Halaman admin: `/admin/products` (cari, filter, urut, paginasi, sold out per
outlet), `/admin/products/new`, `/admin/products/[id]/edit`,
`/admin/categories`, dan `/admin/modifiers` (preset Size, Hot/Ice, Sugar
Level, Extra Shot, Milk Options, Topping). Menu customer ada di
`/order?outlet=SDY01&table=T03`.

- **Scope:** data master menu (nama, harga, kategori, modifier, foto) berlaku
  untuk semua outlet satu brand, jadi butuh permission `product.*`
  company-wide. Status sold out berlaku per outlet dan cukup memakai
  `product.edit` di outlet tersebut (misalnya Manager outlet).
- **Harga dihitung server:** browser hanya mengirim id produk, id modifier, dan
  jumlah. Harga kiriman browser dibuang
  ([src/lib/catalog/quote.ts](src/lib/catalog/quote.ts)).
- **Soft delete:** produk dan kategori tidak dihapus fisik karena dirujuk
  histori order. Slug dan SKU hanya wajib unik di antara data yang belum dihapus.
- **Audit:** `product.created/updated/price_changed/image_changed/deleted/availability_changed`,
  `category.*`, dan `modifier_group.*`.
- **Foto menu:** disimpan di bucket Supabase Storage `menu-images` yang
  **publik untuk dibaca** agar customer guest bisa melihatnya. Upload dan
  hapus hanya lewat Server Action dengan service role. Tidak ada policy
  anon/authenticated, jadi browser tidak bisa menulis langsung. Format yang
  diterima JPG, PNG, atau WebP (dicek dari isi file), maksimal 2 MB.
  `npm run storage:setup` membuat atau menyelaraskan bucket ini, dan gagal
  kalau menemukan bucket publik lain. Bucket absensi atau biometrik nanti wajib
  private.
- **Cache:** menu customer di-cache (`use cache`, profil `minutes`) dan
  langsung di-invalidate (`updateTag`) setiap kali admin mengubah katalog.

## Test

| Script             | Isi                                                          |
| ------------------ | ------------------------------------------------------------ |
| `npm test`         | Unit test (RBAC, policy, open redirect) + integrasi DB live   |
| `npm run test:e2e` | HTTP end-to-end terhadap `next start` (jalankan `npm run build` dulu) |

Test integrasi dan e2e memakai Supabase dari `.env.local`. Test ini membuat
company dan user sementara (`sudaya-test-*@example.com`) lalu menghapusnya
kembali. Test live otomatis dilewati kalau kredensial belum ada atau Node di
bawah 22.

## Script

| Script                    | Fungsi                                          |
| ------------------------- | ----------------------------------------------- |
| `npm run dev`             | Dev server                                      |
| `npm run build`           | Build produksi                                  |
| `npm run lint`            | ESLint                                          |
| `npm run typecheck`       | Cek tipe TypeScript                             |
| `npm test`                | Unit + integration test                         |
| `npm run test:e2e`        | E2E test (butuh build)                          |
| `npm run db:generate`     | Buat file migrasi dari perubahan `src/db/schema` |
| `npm run db:migrate`      | Terapkan migrasi ke database                    |
| `npm run db:seed`         | Seed company/brand/outlet + RBAC (idempotent)   |
| `npm run admin:bootstrap` | Siapkan Super Admin pertama                     |
| `npm run storage:setup`   | Siapkan bucket foto menu (idempotent)           |
| `npm run db:studio`       | Buka Drizzle Studio                             |

## Struktur

```
src/
  app/            Route per interface (order, kiosk, staff, kds, admin, login, auth)
  components/     Komponen app; components/ui = shadcn/ui
  db/
    schema/       Skema Drizzle per domain (tenancy, identity, orders, ...)
    client.ts     Factory koneksi (dipakai app, script, test)
    index.ts      Drizzle client app (server-only)
    seed.ts       Seeder idempotent
  lib/auth/       RBAC katalog, policy murni, DAL session, operasi admin, bootstrap
  lib/catalog/    Menu: admin ops, storefront, harga/quote, validasi, foto
  lib/supabase/   Supabase client: server, browser, proxy, admin (service role)
  proxy.ts        Next.js Proxy (dulu middleware): refresh session + guard area internal
scripts/          CLI: db-seed, admin-bootstrap, storage-setup
tests/            unit, integration (DB live), e2e (HTTP)
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
