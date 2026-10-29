import { getPublicEnv } from "@/lib/env";

/** Satu-satunya bucket publik. Data absensi/biometrik wajib di bucket private. */
export const MENU_IMAGE_BUCKET = "menu-images";

/** URL publik foto menu (bucket menu-images publik, read-only bagi guest). */
export function menuImageUrl(path: string | null) {
  if (!path) return null;
  const base = getPublicEnv().NEXT_PUBLIC_SUPABASE_URL;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${MENU_IMAGE_BUCKET}/${encoded}`;
}
