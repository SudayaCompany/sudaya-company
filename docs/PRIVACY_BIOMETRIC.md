# Pelindungan Data Biometrik — Absensi Sudaya

Dokumen kerja untuk pengelola data Sudaya Company. Bukan nasihat hukum; tinjau
bersama penasihat hukum / pejabat pelindungan data sebelum biometrik dipakai
operasional.

Status per 2026-10-30: **provider verifikasi wajah belum ditetapkan**. Aplikasi
belum memproses data biometrik apa pun; absensi dicatat lewat koreksi manual
yang disetujui atasan.

## 1. Data & alur

| Data | Disimpan di | Keterangan |
| --- | --- | --- |
| Gambar wajah (kamera) | Tidak disimpan oleh Sudaya | Dikirim langsung oleh SDK provider ke provider saat sesi liveness |
| Template / embedding wajah | Provider | Sudaya hanya menyimpan `face_enrollments.external_face_id` (referensi) |
| Skor liveness & kecocokan | `face_verification_sessions`, `attendances` | Angka skor, tanpa gambar |
| Persetujuan | `biometric_consents` | Versi pemberitahuan, dasar, waktu, IP, user agent, waktu penarikan |
| Lokasi absensi | `attendances` | Koordinat, akurasi, jarak ke outlet (bukan data biometrik) |

Audit log tidak pernah berisi foto, template, referensi subjek provider,
token, atau kredensial.

## 2. Dasar pemrosesan (UU No. 27/2022)

- Data biometrik = data pribadi yang bersifat spesifik (Pasal 4).
- Dasar yang dipakai aplikasi: **persetujuan eksplisit** (`basis = explicit_consent`),
  dicatat per versi pemberitahuan (`BIOMETRIC_NOTICE_VERSION`).
- Dalam hubungan kerja, persetujuan berisiko tidak sepenuhnya bebas. Karena itu
  disediakan **alternatif tanpa biometrik** (koreksi manual dengan approval)
  dan penolakan/penarikan tidak berakibat sanksi.
- Persetujuan saja tidak menyelesaikan seluruh kewajiban: tetap perlu
  pembatasan tujuan, minimisasi data, keamanan, retensi, dan penilaian dampak.

## 3. Sebelum mengaktifkan provider (checklist)

1. **Penilaian dampak pelindungan data pribadi (DPIA)** untuk pemrosesan biometrik
   karyawan.
2. **Review provider**: lokasi pemrosesan & penyimpanan, transfer lintas negara,
   enkripsi at-rest/in-transit, retensi di sisi provider, sub-prosesor,
   sertifikasi, kemampuan penghapusan template, dukungan liveness + face matching
   (keduanya wajib).
3. **Perjanjian pemrosesan data** dengan provider (peran pengendali/prosesor,
   larangan penggunaan data untuk melatih model, notifikasi insiden).
4. Tetapkan **ambang liveness & kecocokan** dari dokumentasi provider + uji
   lapangan dengan relawan yang memberi persetujuan (bukan data karyawan
   sungguhan tanpa persetujuan). Catat di Pengaturan absensi.
5. Implementasikan adapter server (`src/lib/attendance/face-provider.ts`) dan
   SDK kamera (`src/lib/attendance/face-client.ts`); kredensial hanya sebagai
   environment variable server (tanpa prefix `NEXT_PUBLIC_`).
6. Isi kode provider di Pengaturan absensi dan perbarui versi kebijakan; bila
   isi pemberitahuan berubah, naikkan `BIOMETRIC_NOTICE_VERSION` (persetujuan
   lama otomatis tidak berlaku).

## 4. Retensi & penghapusan

- Template di provider dihapus saat: karyawan menarik persetujuan, admin
  mencabut registrasi, atau karyawan dinonaktifkan.
- Jika provider tidak bisa dihubungi, `face_enrollments.provider_deleted_at`
  tetap kosong → **tindak lanjuti** (daftar pencabutan "penghapusan di provider
  tertunda" terlihat di detail karyawan).
- Catatan absensi (waktu, lokasi, status) disimpan sesuai kewajiban administrasi
  ketenagakerjaan; tetapkan masa simpan resmi perusahaan.

## 5. Hak subjek data

| Permintaan | Cara |
| --- | --- |
| Akses status & persetujuan | Karyawan: `/staff/face-enrollment`; admin: detail karyawan |
| Tarik persetujuan / hapus registrasi | Karyawan sendiri di `/staff/face-enrollment`, atau admin (`employee.edit`) di detail karyawan |
| Akses / koreksi data absensi | Karyawan melihat `/staff/attendance/history`; koreksi lewat pengajuan koreksi + approval |
| Penghapusan data pribadi lain | Diajukan ke pengelola data; evaluasi terhadap kewajiban penyimpanan hukum |

Semua pencabutan & penarikan persetujuan tercatat di audit log
(`biometric.enrollment_revoked`, `biometric.consent_withdrawn`).

## 6. Keterbatasan yang diketahui

- **GPS browser dapat dipalsukan** (mock location, emulator, DevTools). Geofence
  adalah salah satu sinyal, bukan bukti anti-kecurangan.
- **Radius 5 m sangat ketat** dibanding akurasi GPS ponsel (umumnya beberapa
  meter di ruang terbuka, lebih buruk di dalam bangunan). Akurasi aktual
  ditampilkan; fix dengan akurasi di atas batas ditolak dan diarahkan ke koreksi
  manual. Radius tidak dilonggarkan otomatis.
- Kamera & GPS hanya tersedia di koneksi aman (HTTPS / localhost).
