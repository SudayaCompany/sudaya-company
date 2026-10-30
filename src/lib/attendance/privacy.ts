// Pemberitahuan privasi biometrik (UU PDP No. 27/2022). Versi dicatat di
// setiap persetujuan; ubah versi setiap kali isi berubah secara material.

export const BIOMETRIC_NOTICE_VERSION = "2026-10-30";
/** Dasar pemrosesan yang dicatat bersama persetujuan. */
export const BIOMETRIC_BASIS = "explicit_consent";

export const BIOMETRIC_NOTICE: { title: string; body: string }[] = [
  {
    title: "Data yang diproses",
    body: "Gambar wajah dari kamera saat registrasi dan saat absensi, diproses oleh layanan verifikasi wajah yang ditunjuk Sudaya. Sudaya Company tidak menyimpan foto atau template wajah; yang disimpan hanya nomor referensi di layanan tersebut, skor verifikasi, waktu, dan status.",
  },
  {
    title: "Tujuan",
    body: "Hanya untuk memverifikasi identitas Anda saat check-in dan check-out absensi. Data tidak dipakai untuk tujuan lain (mis. pemantauan, pemasaran, atau penilaian kinerja) tanpa dasar hukum baru dan pemberitahuan ulang.",
  },
  {
    title: "Dasar pemrosesan",
    body: "Data biometrik termasuk data pribadi yang bersifat spesifik. Sudaya meminta persetujuan eksplisit Anda. Menolak atau menarik persetujuan tidak mengakibatkan sanksi: absensi tetap bisa dicatat lewat koreksi manual yang disetujui atasan.",
  },
  {
    title: "Retensi & penghapusan",
    body: "Template wajah di layanan verifikasi dihapus ketika Anda menarik persetujuan, ketika registrasi dicabut admin, atau ketika status karyawan dinonaktifkan. Catatan absensi (waktu, lokasi, status) disimpan sesuai kewajiban administrasi ketenagakerjaan.",
  },
  {
    title: "Hak Anda",
    body: "Anda dapat melihat status registrasi, menarik persetujuan & menghapus registrasi kapan saja dari halaman ini, serta mengajukan permintaan akses, koreksi, atau penghapusan data pribadi kepada admin/pengelola data Sudaya Company.",
  },
];
