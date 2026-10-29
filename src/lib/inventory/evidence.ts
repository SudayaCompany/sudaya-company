// Bukti foto stok keluar / waste. Disimpan di bucket PRIVATE
// `inventory-evidence` (bukan bucket menu publik); dibuka lewat signed URL
// berumur pendek setelah cek permission.

import { randomUUID } from "node:crypto";

import { detectImageType } from "@/lib/catalog/images";
import { AccessError } from "@/lib/auth/errors";

import { MAX_EVIDENCE_BYTES } from "./evidence-types";

export { EVIDENCE_BUCKET, EVIDENCE_TYPES, MAX_EVIDENCE_BYTES } from "./evidence-types";

export type EvidenceStorage = {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  signedUrl(path: string, expiresInSeconds: number): Promise<string>;
};

export type EvidencePhoto = { bytes: Uint8Array; ext: string; contentType: string };

/** null jika tidak ada file. Tipe dideteksi dari isi file (magic bytes). */
export async function readEvidencePhoto(file: unknown): Promise<EvidencePhoto | null> {
  if (!(file instanceof Blob) || file.size === 0) return null;
  if (file.size > MAX_EVIDENCE_BYTES) {
    throw new AccessError("invalid", "Ukuran foto bukti maksimal 3 MB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(bytes);
  if (!type) throw new AccessError("invalid", "Foto bukti harus JPG, PNG, atau WebP.");
  return { bytes, ...type };
}

export const evidencePath = (companyId: string, outletId: string, ext: string) =>
  `${companyId}/${outletId}/${randomUUID()}.${ext}`;
