import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit tidak membaca .env.local sendiri (itu fitur Next.js),
// jadi muat manual. Env yang sudah di-set (mis. di CI) tidak ditimpa.
config({ path: ".env.local", quiet: true });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL belum di-set. Salin .env.example ke .env.local lalu isi connection string Supabase.",
  );
}
if (databaseUrl.includes("[YOUR-PASSWORD]")) {
  throw new Error(
    "DATABASE_URL masih berisi placeholder [YOUR-PASSWORD]. Ganti dengan password database Supabase.",
  );
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: { url: databaseUrl },
  // Jangan sentuh schema milik Supabase (auth, storage, realtime).
  schemaFilter: ["public"],
  entities: { roles: { provider: "supabase" } },
});
