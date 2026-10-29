import { requireEnv } from "./env";

import { createDatabase } from "@/db/client";
import { seedInitialData } from "@/db/seed";

async function main() {
  const { db, client } = createDatabase(requireEnv("DATABASE_URL"), { max: 1 });
  try {
    const report = await seedInitialData(db);
    console.log("✔ Seed selesai");
    console.log(`  Company Sudaya Company : ${report.company}`);
    console.log(`  Brand Sudaya Coffee    : ${report.brand}`);
    console.log(`  Outlet SDY01           : ${report.outlet}`);
    console.log(`  Permission baru        : ${report.permissionsCreated}`);
    console.log(
      `  Role baru              : ${report.rolesCreated.length ? report.rolesCreated.join(", ") : "-"}`,
    );
    console.log(`  Role-permission baru   : ${report.rolePermissionsCreated}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("✖ Seed gagal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
