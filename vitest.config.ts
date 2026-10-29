import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // server-only melempar error di luar React Server; aman di test Node.
      "server-only": fileURLToPath(new URL("./tests/stubs/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup-env.ts"],
    // Test integrasi memakai DB bersama; jalankan file berurutan.
    fileParallelism: false,
    // Test live ke Supabase (region jauh) bisa lambat saat jaringan padat.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
