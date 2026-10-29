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
    // Upload foto menu lewat Server Action (maks 2 MB + overhead form).
    serverActions: { bodySizeLimit: "3mb" },
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
