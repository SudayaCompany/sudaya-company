// Dimuat paling awal oleh setiap script CLI. Next.js memuat .env.local
// sendiri, tetapi script tsx tidak.
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// @supabase/supabase-js butuh WebSocket native (Node 22+).
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) {
  console.error(
    `✖ Butuh Node.js 22+ (terdeteksi ${process.versions.node}). Lihat .nvmrc.`,
  );
  process.exit(1);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`✖ ${name} belum di-set di .env.local (lihat .env.example).`);
    process.exit(1);
  }
  return value;
}
