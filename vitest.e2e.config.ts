import { defineConfig } from "vitest/config";

import base from "./vitest.config";

// E2E: menjalankan `next start` dari hasil `npm run build` lalu menguji
// route lewat HTTP dengan session Supabase sungguhan.
// (Tidak memakai mergeConfig karena array `include` akan digabung.)
export default defineConfig({
  resolve: base.resolve,
  test: {
    ...base.test,
    include: ["tests/e2e/**/*.test.ts"],
    globalSetup: ["tests/e2e/global-setup.ts"],
    testTimeout: 120_000,
  },
});
