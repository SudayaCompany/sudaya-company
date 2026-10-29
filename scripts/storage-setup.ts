// npm run storage:setup — memastikan bucket Supabase Storage sesuai kebijakan.
// Idempotent: membuat bucket bila belum ada, atau menyelaraskan pengaturannya.
//
// Kebijakan:
// - menu-images: PUBLIC read (foto menu untuk customer guest), upload/hapus
//   hanya lewat server (service role). Tanpa policy anon/authenticated.
// - Bucket lain (mis. absensi, biometrik) WAJIB private. Script ini menolak
//   melanjutkan jika menemukan bucket publik selain menu-images.

import { requireEnv } from "./env";

import { createClient } from "@supabase/supabase-js";

import {
  MAX_MENU_IMAGE_BYTES,
  MENU_IMAGE_BUCKET,
  MENU_IMAGE_TYPES,
} from "@/lib/catalog/images";

async function main() {
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const options = {
    public: true,
    fileSizeLimit: MAX_MENU_IMAGE_BYTES,
    allowedMimeTypes: [...MENU_IMAGE_TYPES],
  };

  const { data: existing } = await supabase.storage.getBucket(MENU_IMAGE_BUCKET);
  const { error } = existing
    ? await supabase.storage.updateBucket(MENU_IMAGE_BUCKET, options)
    : await supabase.storage.createBucket(MENU_IMAGE_BUCKET, options);
  if (error) throw new Error(`Gagal menyiapkan bucket ${MENU_IMAGE_BUCKET}: ${error.message}`);
  console.log(`✔ Bucket ${MENU_IMAGE_BUCKET}: ${existing ? "diselaraskan" : "dibuat"} (publik, maks 2 MB, JPG/PNG/WebP)`);

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw new Error(listError.message);
  const unexpectedPublic = buckets.filter((b) => b.public && b.id !== MENU_IMAGE_BUCKET);
  if (unexpectedPublic.length) {
    console.error(
      `✖ Bucket publik selain ${MENU_IMAGE_BUCKET}: ${unexpectedPublic.map((b) => b.id).join(", ")}. ` +
        "Bucket untuk absensi/biometrik wajib private.",
    );
    process.exit(1);
  }
  console.log(`✔ Bucket lain private (${buckets.length - 1} bucket lain).`);
}

main().catch((error: unknown) => {
  console.error("✖", error instanceof Error ? error.message : error);
  process.exit(1);
});
