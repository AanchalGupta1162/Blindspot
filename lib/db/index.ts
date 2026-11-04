import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { acquireDatabaseLease } from "./lease";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Neon (or any Postgres) when DATABASE_URL is set; otherwise an embedded Postgres (PGlite) stored in
 * .data/pglite so the app runs with zero setup. Both speak the same SQL and use the same schema + migrations.
 */
export const usingNeon = () => !!process.env.DATABASE_URL;

const g = globalThis as unknown as { __blindspotDb?: { db: DB; close: () => Promise<void> } };

function create() {
  if (process.env.NEXT_PHASE === "phase-production-build") throw new Error("Database access is disabled during production builds");
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 8000 });
    // pg removes failed idle clients itself; handle its error event so a remote restart
    // cannot become an unhandled EventEmitter error that terminates the frontend server.
    pool.on("error", (error) => {
      console.warn("Idle database connection closed; the pool will reconnect.", (error as { code?: string }).code ?? "connection_error");
    });
    return { db: drizzlePg(pool, { schema }) as unknown as DB, close: () => pool.end() };
  }
  const dir = process.env.PGLITE_DIR ?? ".data/pglite";
  if (!dir.startsWith("memory:")) mkdirSync(path.dirname(dir), { recursive: true });
  const release = acquireDatabaseLease(dir);
  let client: PGlite;
  try { client = new PGlite(dir); } catch (e) { release(); throw e; }
  let closing: Promise<void> | null = null;
  return { db: drizzlePglite(client, { schema }) as unknown as DB, close: () => (closing ??= client.close().finally(release)) };
}

export const getHandle = () => (g.__blindspotDb ??= create());
export const db: DB = new Proxy({} as DB, { get: (_t, p) => (getHandle().db as never)[p] });
export { schema };
