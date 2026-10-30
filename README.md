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
| `/pos`   | POS kasir        | Barista, kasir, manager   | Wajib   |
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

## Order, pembayaran & antrean (Epic 03)

Semua channel memakai satu engine di [src/lib/orders/engine.ts](src/lib/orders/engine.ts):
POS (`/pos`), QR meja (`/order?outlet=SDY01&table=T03`), QR kasir
(`?src=qr`), web, dan kiosk (`/kiosk?outlet=SDY01`).

- **Alur:** order dibuat dengan status `pending_payment`. Kasir mengonfirmasi
  pembayaran tunai, lalu order lunas dan masuk antrean (`queued`) dengan nomor
  `SDY-001`. Barista di `/kds` memindahkannya ke `preparing`, `ready`, lalu
  `completed`. Status produksi (`orders.status`) terpisah dari status
  pembayaran (`orders.payment_status`).
- **Harga dihitung server:** produk, ketersediaan, dan modifier divalidasi
  ulang dari DB saat checkout. Snapshot harga disimpan ke `order_items` dan
  `order_item_modifiers`. Semua nominal berupa integer Rupiah.
- **Idempotency:** `orders.idempotency_key` unik per outlet. Klik ganda atau
  retry mengembalikan order yang sama. Konfirmasi bayar mengunci baris order
  (`FOR UPDATE`), jadi bayar dua kali tidak menghasilkan dua nomor antrean.
- **Nomor antrean:** hanya terbit setelah bayar. Counter harian per outlet
  (`order_number_counters`, tanggal mengikuti zona waktu outlet) memakai upsert
  yang mengunci baris counter, sehingga transaksi bersamaan tidak bisa
  mendapat nomor yang sama. `paid_at` diambil setelah lock, jadi urutan
  antrean deterministik.
- **Pembatalan:** order yang belum dibayar langsung batal (`order.void`). Order
  yang sudah lunas hanya bisa diajukan, lalu disetujui Manager
  (`approval.approve`, tidak boleh pemohonnya sendiri). Pembatalan tidak
  otomatis mengembalikan uang; refund diproses terpisah.
- **Riwayat & audit:** `order.created`, `payment.confirmed`, `order.queued`,
  `order.preparing/ready/completed`, `order.status_override`,
  `order.cancel_requested`, `approval.approved/rejected`, dan
  `order.cancelled`. Riwayat ini tampil di `/admin/orders/[id]`.
- **Akses guest:** token acak 256-bit dikirim lewat cookie httpOnly (path
  `/order/status`), dan yang disimpan di DB hanya hash-nya. Halaman status
  memakai `no-referrer` dan `noindex`. Nomor antrean atau id order saja tidak
  cukup untuk membuka detail pesanan.
- **Realtime:** `realtime.send()` dipanggil di dalam transaksi, jadi pesan
  hanya terkirim kalau transaksi commit. Broadcast publik **tanpa payload**
  (sinyal saja), lalu client memuat ulang data lewat jalur server yang
  diotorisasi (`router.refresh()`). RLS tidak dibuka. Topik `outlet-orders:<id>`
  untuk KDS dan POS, dan `order:<turunan hash token>` untuk customer. Kalau
  Realtime tidak tersambung, otomatis beralih ke polling terbatas.
- **Payment gateway:** abstraksi ada di
  [src/lib/payments/provider.ts](src/lib/payments/provider.ts). Midtrans atau
  Xendit belum dikonfigurasi, jadi QRIS tampil "belum tersedia" dan tidak ada
  jalur yang bisa menandai order lunas tanpa konfirmasi kasir.
- **Diskon** belum ada karena belum ada aturan maupun permission diskon (Phase 2).

## Hardening checkout (Epic 04)

- **Rate limit checkout guest:** checkout QR/web/kiosk lewat Route Handler
  `POST /api/orders` (bukan Server Action) supaya bisa menjawab **HTTP 429 +
  `Retry-After`**. Counter fixed-window disimpan di Postgres
  (`rate_limit_counters`, key di-hash, satu upsert atomik), jadi konsisten di
  semua instance serverless tanpa layanan tambahan. Batas per 10 menit
  ([src/lib/orders/checkout-limits.ts](src/lib/orders/checkout-limits.ts)):
  6 order per perangkat (cookie acak `sdy_did`), 40 untuk kiosk, 60 per IP
  (longgar agar Wi-Fi outlet yang dipakai banyak customer tidak terblokir).
  Retry dengan idempotency key yang sama tidak memakai kuota. Request lintas
  origin atau bukan JSON ditolak.
- **IP tepercaya saja:** di Vercel dipakai `x-vercel-forwarded-for` /
  `x-real-ip` (ditimpa edge Vercel). Self-host di belakang reverse proxy: set
  `TRUSTED_IP_HEADER` (mis. `x-real-ip`). Tanpa itu header IP kiriman client
  diabaikan dan batas jaringan memakai cadangan per outlet (120 / 10 menit).
- **Kedaluwarsa order belum dibayar:** `orders.expires_at = now() DB + TTL`
  (`outlets.pending_payment_ttl_minutes`, default 15). Fungsi
  `public.expire_pending_orders()` dijalankan **pg_cron tiap menit**: hanya
  order `pending_payment` + payment `pending` yang lewat batas, memakai
  `FOR UPDATE SKIP LOCKED` (pembayaran yang sedang berjalan tidak diganggu),
  idempotent, menulis audit `order.expired` dan sinyal realtime. Order lunas
  tidak pernah cocok dengan filter. Kasir yang mencoba membayar order lewat
  batas ditolak dan order langsung dikedaluwarsakan. Halaman status customer
  menampilkan batas bayar dan hitung mundur.

## Inventory (Epic 04)

Halaman di `/admin/inventory` (ringkasan), `items`, `movements`, `stock-in`,
`stock-out`, `waste`, `opname`. Semua operasi ada di
[src/lib/inventory](src/lib/inventory).

- **Ledger append-only:** satu-satunya jalur yang mengubah
  `inventory_items.stock_qty` adalah `postMovement()` di
  [src/lib/inventory/ledger.ts](src/lib/inventory/ledger.ts): kunci baris item
  (`FOR UPDATE`), cek idempotency key (unik per outlet), tolak saldo negatif,
  lalu update saldo + insert ledger dalam satu transaksi. Trigger database
  menolak UPDATE/DELETE/TRUNCATE pada `inventory_transactions`; CHECK
  constraint menolak saldo negatif. Browser tidak pernah mengirim saldo.
- **Koreksi hanya lewat reversal:** salah input diperbaiki dengan movement
  `reversal` (`reverses_id`, unik → satu movement hanya bisa dibalik sekali).
  Reversal dan koreksi manual (+/−) butuh **approval** (`stock_adjustment`):
  pengaju `inventory.adjust`, pemutus `approval.approve` dan bukan pengaju.
  Stok baru berubah saat disetujui.
- **Satuan & angka eksak:** g/kg, ml/l, dan satuan hitung (pcs, botol, cup,
  pack, sachet, box, lembar). Konversi hanya antar dimensi sama dan harus
  tepat (BigInt, skala 3); kuantitas `numeric(14,3)`, harga pokok
  `numeric(16,4)` per satuan dasar. Harga beli terbaru (stok masuk
  pembelian) menjadi harga pokok item.
- **Stok masuk** (`inventory.receive`): pembelian / retur masuk, tanggal,
  no. referensi, batch, kedaluwarsa, catatan. **Stok keluar & waste**
  (`inventory.issue`): pemakaian internal, stok keluar lainnya, rusak,
  kedaluwarsa, tumpah, salah produksi, dengan foto bukti opsional di bucket
  **privat** `inventory-evidence` (dibuka lewat signed URL 60 detik).
- **Stock opname** (`inventory.opname`): buat sesi → saldo sistem di-snapshot
  → input fisik → variance dihitung server → alasan wajib untuk selisih →
  approval (`stock_opname`). Saat disetujui, **selisih** diterapkan ke saldo
  terkini (mutasi setelah snapshot tetap dihitung), sekali saja (status +
  idempotency key per item). Satu sesi terbuka per outlet (unique index).
  Opname tanpa selisih selesai tanpa approval.
- **Menu & stok:** produk jadi dihubungkan ke item (`outlet_products.inventory_item_id`,
  satuan hitung). Stok dipotong saat order **dibayar** (movement `sale`);
  stok kurang → pembayaran ditolak. Pembatalan order lunas yang disetujui
  mengembalikan stok (reversal). Ketersediaan dihitung terpisah: sold out
  manual (`is_available`, tidak pernah ditimpa stok), stok habis/item
  nonaktif, dan ketersediaan efektif. Minuman racikan tanpa BOM tidak
  memotong bahan baku; tabel `product_recipe_items` disiapkan untuk BOM
  (belum dipakai). Saat stok produk jadi melewati 0, cache katalog customer
  di-invalidate.
- **Dashboard:** item aktif, menipis (≤ minimum), habis, nilai stok (hanya
  item ber-harga pokok, cakupannya ditampilkan), waste bulan ini, penyesuaian,
  opname terakhir, approval menunggu, item hampir kedaluwarsa. Tidak ada angka
  contoh: semua dari ledger.

## Karyawan & absensi (Epic 05)

Status: **Core Attendance Implemented — Biometric Integration Pending.**

- **Karyawan** (`/admin/employees`): Employee ID unik per company, jabatan,
  outlet absensi, tanggal bergabung, status aktif, status registrasi wajah.
  Akun login & role tetap dikelola di `/admin/users` lalu ditautkan; password
  tidak pernah disimpan di data karyawan. Hanya akun aktif + karyawan aktif +
  outlet aktif yang bisa absen. Menonaktifkan karyawan mencabut registrasi wajah.
- **Absensi staf** (`/staff/attendance`): online → kamera → GPS → verifikasi
  wajah (liveness + face matching di provider) → check-in/out. Waktu selalu dari
  database; satu sesi terbuka per karyawan (unique index); check-out kondisional
  (dua check-out bersamaan → satu perubahan); `working_minutes` dari timestamp DB;
  sesi lintas tengah malam memakai tanggal bisnis saat check-in.
- **Verifikasi wajah**: abstraksi provider di
  [src/lib/attendance/face-provider.ts](src/lib/attendance/face-provider.ts).
  Sesi verifikasi diterbitkan server untuk satu karyawan dan hanya bisa dipakai
  sekali; keputusan lulus/gagal dibuat server dengan ambang tersimpan. **Belum
  ada provider yang disetujui**, jadi aplikasi menampilkan "Layanan verifikasi
  wajah belum dikonfigurasi", tidak ada absensi yang ditandai biometrik, dan
  tidak ada mode mock (implementasi palsu hanya di automated test).
- **Geofence**: Haversine di server, radius per outlet (`attendance_radius_meter`,
  default 5 m, diatur Super Admin), batas akurasi GPS (`max_gps_accuracy_meter`),
  posisi cache lama ditolak. Outlet tanpa koordinat → absensi reguler tidak bisa
  dipakai (tidak ada koordinat contoh). GPS browser bisa dipalsukan — lihat
  [docs/PRIVACY_BIOMETRIC.md](docs/PRIVACY_BIOMETRIC.md).
- **Tugas luar** (`/staff/outside-duty`, `/admin/outside-duty`): approval
  `attendance.approve_outside_duty`, pemohon tidak bisa menyetujui sendiri; di
  jam tugas yang disetujui geofence outlet tidak berlaku, wajah & GPS tetap dicatat.
- **Koreksi manual** (`/staff/attendance/correction`): untuk provider belum
  tersedia/gagal, GPS tidak akurat, atau lupa check-out. Disetujui Manager
  (`approval.approve`, bukan pemohon) dan berlabel `manual_correction` — tidak
  pernah menyamar sebagai absensi biometrik.
- **Dashboard & laporan** (`/admin/attendance`, `/admin/attendance/reports`):
  jam kerja aktual, filter tanggal/nama/outlet/status; laporan memisahkan
  terverifikasi biometrik, koreksi manual, tugas luar, dan data belum lengkap;
  unduh CSV / Excel (aman dari formula injection, setiap ekspor diaudit).
  Tanpa jadwal shift resmi, "belum check-in" tidak dihitung terlambat/absen.
- **Privasi** (`/staff/face-enrollment`): pemberitahuan privasi berversi,
  persetujuan eksplisit tercatat, penarikan persetujuan & penghapusan registrasi
  oleh karyawan maupun admin. Checklist DPIA, review provider, retensi, dan hak
  subjek data ada di [docs/PRIVACY_BIOMETRIC.md](docs/PRIVACY_BIOMETRIC.md).
- **Audit**: consent/enrollment/pencabutan, check-in/out, verifikasi & lokasi
  ditolak (tanpa data biometrik), tugas luar, koreksi, perubahan geofence &
  pengaturan, ekspor laporan.

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
| `npm run storage:setup`   | Siapkan bucket foto menu, bukti stok & tugas luar (idempotent) |
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
  lib/inventory/  Stok: ledger, operasi, query, satuan, approval, opname
  lib/attendance/ Karyawan, absensi, geofence, provider wajah, tugas luar, koreksi
  lib/orders/     Order engine, checkout limit, token guest, realtime
  lib/security/   IP tepercaya & rate limit (Postgres)
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
