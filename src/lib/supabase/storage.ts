import "server-only";

import { MENU_IMAGE_BUCKET, type MenuImageStorage } from "@/lib/catalog/images";
import { EVIDENCE_BUCKET, type EvidenceStorage } from "@/lib/inventory/evidence";

import { createAdminClient } from "./admin";

/**
 * Upload/hapus foto menu lewat service role (server only). Bucket tidak
 * punya policy untuk anon/authenticated, jadi browser tidak bisa menulis
 * langsung; hanya Server Action yang sudah lolos cek permission.
 */
export const menuImageStorage: MenuImageStorage = {
  async upload(path, bytes, contentType) {
    const { error } = await createAdminClient()
      .storage.from(MENU_IMAGE_BUCKET)
      .upload(path, bytes, { contentType, upsert: false, cacheControl: "31536000" });
    if (error) throw new Error(`Upload foto gagal: ${error.message}`);
  },

  async remove(paths) {
    if (paths.length === 0) return;
    const { error } = await createAdminClient().storage.from(MENU_IMAGE_BUCKET).remove(paths);
    if (error) throw new Error(`Hapus foto gagal: ${error.message}`);
  },
};

/**
 * Bukti foto inventory (bucket PRIVATE). Tidak ada URL publik: halaman
 * membuka foto lewat signed URL singkat setelah cek permission.
 */
export const inventoryEvidenceStorage: EvidenceStorage = {
  async upload(path, bytes, contentType) {
    const { error } = await createAdminClient()
      .storage.from(EVIDENCE_BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    if (error) throw new Error(`Upload bukti gagal: ${error.message}`);
  },

  async remove(paths) {
    if (paths.length === 0) return;
    const { error } = await createAdminClient().storage.from(EVIDENCE_BUCKET).remove(paths);
    if (error) throw new Error(`Hapus bukti gagal: ${error.message}`);
  },

  async signedUrl(path, expiresInSeconds) {
    const { data, error } = await createAdminClient()
      .storage.from(EVIDENCE_BUCKET)
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data) throw new Error(`Signed URL gagal: ${error?.message ?? "kosong"}`);
    return data.signedUrl;
  },
};
