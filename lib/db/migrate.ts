import path from "node:path";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { getHandle, usingNeon, type DB } from "./index";

const g = globalThis as unknown as { __blindspotMigrated?: Promise<void> };

/** Applies pending SQL migrations from ./drizzle. Safe to call repeatedly; runs once per process. */
export function ensureMigrated(): Promise<void> {
  return (g.__blindspotMigrated ??= (async () => {
    const folder = path.join(process.cwd(), "drizzle");
    const { db } = getHandle();
    if (usingNeon()) await migratePg(db as never, { migrationsFolder: folder });
    else await migratePglite(db as never, { migrationsFolder: folder });
  })());
}
export type { DB };
