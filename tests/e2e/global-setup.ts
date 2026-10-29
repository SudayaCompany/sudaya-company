import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export const E2E_PORT = 3210;

/** Menjalankan `next start` dari hasil build sebelum test e2e. */
export default async function setup() {
  if (!existsSync(".next/BUILD_ID")) {
    throw new Error("Hasil build tidak ada. Jalankan `npm run build` sebelum `npm run test:e2e`.");
  }

  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(E2E_PORT)],
    { stdio: "pipe", env: { ...process.env, NODE_ENV: "production" } },
  );
  let log = "";
  server.stdout.on("data", (chunk) => (log += chunk));
  server.stderr.on("data", (chunk) => (log += chunk));

  const stop = () => {
    if (process.platform === "win32" && server.pid) {
      spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
    } else {
      server.kill();
    }
  };

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const response = await fetch(`http://localhost:${E2E_PORT}/order`);
      if (response.ok) break;
    } catch {
      // server belum siap
    }
    if (Date.now() > deadline) {
      stop();
      throw new Error(`next start tidak siap dalam 60 detik:\n${log.slice(-2000)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return stop;
}
