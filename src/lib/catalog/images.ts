import { randomUUID } from "node:crypto";

import { AccessError } from "@/lib/auth/errors";

import { MAX_MENU_IMAGE_BYTES } from "./image-types";

export { MAX_MENU_IMAGE_BYTES, MENU_IMAGE_TYPES } from "./image-types";
export { MENU_IMAGE_BUCKET } from "./image-url";

export type MenuImageStorage = {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
};

export type MenuImage = { bytes: Uint8Array; ext: string; contentType: string };

/** Deteksi tipe dari isi file (magic bytes), bukan dari nama/MIME kiriman client. */
export function detectImageType(bytes: Uint8Array): Omit<MenuImage, "bytes"> | null {
  const at = (i: number) => bytes[i];
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" };
  }
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)) {
    return { ext: "png", contentType: "image/png" };
  }
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { ext: "webp", contentType: "image/webp" };
  }
  return null;
}

/** null jika tidak ada file yang diunggah. Melempar AccessError jika tidak valid. */
export async function readMenuImage(file: unknown): Promise<MenuImage | null> {
  if (!(file instanceof Blob) || file.size === 0) return null;
  if (file.size > MAX_MENU_IMAGE_BYTES) {
    throw new AccessError("invalid", "Ukuran foto maksimal 2 MB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(bytes);
  if (!type) {
    throw new AccessError("invalid", "Format foto harus JPG, PNG, atau WebP.");
  }
  return { bytes, ...type };
}

export function menuImagePath(companyId: string, brandId: string, ext: string) {
  return `${companyId}/${brandId}/${randomUUID()}.${ext}`;
}
