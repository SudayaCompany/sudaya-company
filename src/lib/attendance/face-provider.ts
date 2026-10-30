// Abstraksi layanan verifikasi wajah (PRD §11, §12, §82). Semua proses
// biometrik terjadi di provider khusus lewat integrasi server-side:
// - liveness detection: orang nyata di depan kamera (bukan foto/video);
// - face matching: wajah cocok dengan template karyawan yang terdaftar.
// Liveness saja TIDAK membuktikan identitas; keduanya wajib lulus.
//
// Aplikasi tidak pernah menyimpan foto/embedding wajah. Yang disimpan hanya
// referensi subjek di provider, id sesi, skor, dan status.
//
// Belum ada provider yang ditetapkan & disetujui (DPIA, perjanjian pemrosesan
// data, kredensial), jadi getFaceProvider() mengembalikan null dan UI
// menampilkan "Layanan verifikasi belum dikonfigurasi". Tidak ada mode mock di
// aplikasi; implementasi palsu hanya disuntikkan langsung di automated test.

export type FaceSessionPurpose = "enrollment" | "check_in" | "check_out";

export type FaceSession = {
  providerSessionId: string;
  expiresAt: Date;
  /** Data yang dibutuhkan SDK kamera provider di browser (tanpa secret). */
  client: Record<string, string>;
};

export type ProviderOutcome = {
  /** succeeded = provider selesai memproses; lulus/tidak ditentukan ambang. */
  status: "succeeded" | "failed";
  livenessScore: number | null;
  reason?: string;
};

export type EnrollmentOutcome = ProviderOutcome & {
  /** Id subjek/template di provider (bukan data biometrik). */
  subjectRef: string | null;
};

export type VerificationOutcome = ProviderOutcome & { matchScore: number | null };

export interface FaceVerificationProvider {
  /** Kode provider, disimpan di face_enrollments.provider. */
  readonly id: string;
  createSession(input: { purpose: FaceSessionPurpose; employeeRef: string }): Promise<FaceSession>;
  /** Hasil liveness sesi enrollment + pendaftaran template di provider. */
  completeEnrollment(input: { providerSessionId: string; employeeRef: string }): Promise<EnrollmentOutcome>;
  /** Hasil liveness sesi verifikasi + pencocokan dengan template subjectRef. */
  verify(input: { providerSessionId: string; subjectRef: string }): Promise<VerificationOutcome>;
  /** Hapus template di provider (pencabutan / retensi berakhir). */
  revokeEnrollment(input: { subjectRef: string }): Promise<void>;
}

/** Provider aktif. null = belum dikonfigurasi (belum ada provider yang disetujui). */
export function getFaceProvider(): FaceVerificationProvider | null {
  return null;
}

export type FaceThresholds = { liveness: number | null; match: number | null };

export type ProviderState =
  | { ready: true }
  | { ready: false; reason: "provider_unconfigured" | "thresholds_unset" | "provider_mismatch"; message: string };

export const UNCONFIGURED_MESSAGE = "Layanan verifikasi wajah belum dikonfigurasi.";

/**
 * Biometrik hanya bisa dipakai jika provider ada, sama dengan provider yang
 * disetujui di pengaturan, dan kedua ambang sudah ditetapkan (berdasarkan
 * kemampuan provider + pengujian, bukan angka bawaan).
 */
export function providerState(
  provider: FaceVerificationProvider | null,
  settings: { verificationProvider: string | null } & FaceThresholds,
): ProviderState {
  if (!provider) return { ready: false, reason: "provider_unconfigured", message: UNCONFIGURED_MESSAGE };
  if (settings.verificationProvider !== provider.id) {
    return { ready: false, reason: "provider_mismatch", message: UNCONFIGURED_MESSAGE };
  }
  if (settings.liveness === null || settings.match === null) {
    return { ready: false, reason: "thresholds_unset", message: "Ambang verifikasi wajah belum ditetapkan." };
  }
  return { ready: true };
}

export type VerificationDecision =
  | { ok: true }
  | { ok: false; reason: "liveness_failed" | "face_mismatch"; message: string };

/** PRD §12 & §98 — keputusan dibuat server dengan ambang tersimpan. */
export function evaluateVerification(
  outcome: VerificationOutcome,
  thresholds: { liveness: number; match: number },
): VerificationDecision {
  if (outcome.status !== "succeeded" || outcome.livenessScore === null || outcome.livenessScore < thresholds.liveness) {
    return { ok: false, reason: "liveness_failed", message: "Wajah tidak dapat diverifikasi." };
  }
  if (outcome.matchScore === null || outcome.matchScore < thresholds.match) {
    return { ok: false, reason: "face_mismatch", message: "Wajah tidak dikenali. Silakan coba kembali." };
  }
  return { ok: true };
}

export function evaluateEnrollment(
  outcome: EnrollmentOutcome,
  thresholds: { liveness: number },
): VerificationDecision {
  if (
    outcome.status !== "succeeded" ||
    !outcome.subjectRef ||
    outcome.livenessScore === null ||
    outcome.livenessScore < thresholds.liveness
  ) {
    return { ok: false, reason: "liveness_failed", message: "Wajah tidak dapat diverifikasi. Ulangi registrasi." };
  }
  return { ok: true };
}
