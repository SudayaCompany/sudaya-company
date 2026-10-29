import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case",
  // Migrasi lewat koneksi langsung / session pooler, bukan transaction pooler.
  dbCredentials: { url: process.env.DATABASE_DIRECT_URL ?? "" },
  // Jangan sentuh schema milik Supabase (auth, storage, realtime).
  schemaFilter: ["public"],
  entities: { roles: { provider: "supabase" } },
});
