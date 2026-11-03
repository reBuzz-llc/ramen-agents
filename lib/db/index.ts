// The database: Lakebase Postgres on Neon at DATABASE_URL, or, when it is empty, PGlite -- a real Postgres compiled to
// WebAssembly -- on disk in .data/ for development, in memory for tests. Both run the same migrations from ./drizzle.
import path from "node:path";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleLite } from "drizzle-orm/pglite";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migrateLite } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzleLite<typeof schema>> | ReturnType<typeof drizzlePg<typeof schema>>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");
const g = globalThis as { __db?: Promise<Db> };

/** A fresh in-memory database with the schema applied (tests use one each). `onQuery` sees every query after the
 *  migrations, so a test can count a page's round trips. */
export async function memoryDb(dataDir?: string, onQuery?: (sql: string) => void): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const hook = { on: false };
  const logger = onQuery ? { logQuery: (q: string) => hook.on && onQuery(q) } : undefined;
  const db = drizzleLite(dataDir ? new PGlite(dataDir) : new PGlite(), { schema, logger });
  await migrateLite(db, { migrationsFolder: MIGRATIONS });
  hook.on = true;
  return db;
}

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL?.trim();
  // No DATABASE_URL: a local PGlite kept on disk in .data/ (git-ignored), so a restart keeps your data.
  if (!url) {
    const dir = process.env.PGLITE_DIR || path.join(process.cwd(), ".data", "pglite");
    (await import("node:fs")).mkdirSync(dir, { recursive: true });
    return memoryDb(dir);
  }
  // Neon's guidance for Next.js on Vercel: node-postgres on the pooled URL for the app's queries, the pool attached to
  // Vercel Fluid compute.
  const { Pool } = await import("pg");
  // Migrations run before the app starts (scripts/migrate.mjs: Vercel's build, and `npm run start`), not on every cold
  // start. Only the dev server still migrates as it opens, so a schema change is there at once on this Mac.
  if (process.env.NODE_ENV !== "production") {
    const direct = process.env.DATABASE_URL_UNPOOLED?.trim() || url;
    const migrator = new Pool({ connectionString: direct, max: 1 });
    try {
      await migratePg(drizzlePg(migrator, { schema }), { migrationsFolder: MIGRATIONS });
    } finally {
      await migrator.end();
    }
  }
  // Keep connections: from far away a new TLS connection to us-east-2 costs about a second, so the default 10 s idle timeout
  // made most page views pay it again. Five minutes, with TCP keep-alive, matches Neon's own suspend window.
  const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 5 * 60_000, keepAlive: true });
  try {
    (await import("@vercel/functions")).attachDatabasePool(pool);
  } catch {
    /* not on Vercel: the pool just lives with the process */
  }
  return drizzlePg(pool, { schema });
}

/** The app's database, opened and migrated once per server process. */
export function db(): Promise<Db> {
  // A failed open is not kept: the next request tries again instead of failing forever.
  g.__db ??= open().catch((err) => {
    g.__db = undefined;
    throw err;
  });
  return g.__db;
}

export { schema };
