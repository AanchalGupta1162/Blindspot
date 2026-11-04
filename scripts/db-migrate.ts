/** Apply pending migrations to DATABASE_URL (Neon) or the embedded local database. `npm run db:migrate` */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

(async () => {
  const { ensureMigrated } = await import("../lib/db/migrate");
  const { usingNeon, getHandle } = await import("../lib/db");
  await ensureMigrated();
  console.log(usingNeon() ? "migrated: Neon / DATABASE_URL" : "migrated: embedded Postgres (.data/pglite)");
  await getHandle().close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
