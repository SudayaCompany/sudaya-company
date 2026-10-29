import "server-only";

import { MENU_IMAGE_BUCKET, type MenuImageStorage } from "@/lib/catalog/images";

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
