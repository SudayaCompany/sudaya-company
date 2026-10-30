// SDK kamera provider verifikasi wajah di browser (liveness capture). Setiap
// provider punya SDK sendiri; adapter didaftarkan di sini bersamaan dengan
// adapter server di face-provider.ts. Browser TIDAK pernah memutuskan hasil
// verifikasi — SDK hanya mengirim rekaman langsung ke provider, lalu server
// mengambil hasilnya. Belum ada provider yang disetujui, jadi registry kosong.

export type FaceClientSession = { sessionId: string; provider: string; client: Record<string, string> };

/** Menjalankan liveness capture provider memakai elemen video kamera depan. */
export type FaceClient = (session: FaceClientSession, video: HTMLVideoElement) => Promise<void>;

export const FACE_CLIENTS: Record<string, FaceClient> = {};
