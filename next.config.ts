import type { NextConfig } from "next";

// Foto menu disajikan dari bucket publik Supabase Storage (menu-images).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    remotePatterns: supabaseUrl
      ? [new URL(`${supabaseUrl}/storage/v1/object/public/menu-images/**`)]
      : [],
  },
  experimental: {
    // forbidden() + app/forbidden.tsx untuk halaman 403.
    authInterrupts: true,
    // Upload foto lewat Server Action: menu maks 2 MB, bukti stok maks 3 MB
    // (+ overhead form). Tetap di bawah batas body Vercel 4,5 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
