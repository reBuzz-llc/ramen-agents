// The database: Lakebase Postgres on Neon at DATABASE_URL, or, when it is empty, PGlite -- a real Postgres compiled to
// WebAssembly -- on disk in .data/ for development, in memory for tests. Both run the same migrations from ./drizzle.
import path from "node:path";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleLite } from "drizzle-orm/pglite";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migrateLite } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";
import { poolErrorLine, poolOptions, withReadRetry } from "./pool-options";

export type Db = ReturnType<typeof drizzleLite<typeof schema>> | ReturnType<typeof drizzlePg<typeof schema>>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");
const g = globalThis as { __db?: Promise<Db> };

/** A fresh in-memory database with the schema applied (tests use one each). `onQuery` sees every query after the
 *  migrations, so a test can count a page's round trips. */
export async function memoryDb(dataDir?: string, onQuery?: (sql: string) => void): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const hook = { on: false };
  const logger = onQuery ? { logQuery: (q: string) => hook.on && onQuery(q) } : undefined;
  // an in-memory database (the tests) starts from one migrated copy, made once per process, instead of
  // running every migration again; a database on disk (this Mac's dev data) migrates as before
  if (!dataDir) {
    const db = drizzleLite(new PGlite({ loadDataDir: await migratedImage(PGlite) }), { schema, logger });
    hook.on = true;
    return db;
  }
  const lite = new PGlite(dataDir);
  // a database the starter's older portal branch made needs its own 0036 bridged first (lib/db/portal-bridge.mjs)
  const { bridgePortal } = await import("./portal-bridge.mjs");
  await bridgePortal((text: string, params?: unknown[]) => lite.query(text, params));
  const db = drizzleLite(lite, { schema, logger });
  await migrateLite(db, { migrationsFolder: MIGRATIONS });
  hook.on = true;
  return db;
}

/** The migrated empty database as PGlite's data-dir image (a tarball), made once per process and reused. */
const gm = globalThis as { __peekMigrated?: Promise<Blob> };
function migratedImage(PGlite: typeof import("@electric-sql/pglite").PGlite): Promise<Blob> {
  gm.__peekMigrated ??= (async () => {
    const pg = new PGlite();
    await migrateLite(drizzleLite(pg, { schema }), { migrationsFolder: MIGRATIONS });
    const image = await pg.dumpDataDir("none");
    await pg.close();
    return image;
  })();
  return gm.__peekMigrated;
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
  // Off Vercel, keep connections (a new TLS connection to the database's region costs about half a second); on Vercel a
  // short idle timeout and no attached pool, so a function is billed for its request only (lib/db/pool-options.ts).
  const plan = poolOptions(process.env);
  const pool = new Pool({ connectionString: url, max: plan.max, min: plan.min, idleTimeoutMillis: plan.idleTimeoutMillis, keepAlive: plan.keepAlive, keepAliveInitialDelayMillis: plan.keepAliveInitialDelayMillis });
  // An idle client's error had no handler and became an uncaughtException; now one timed line (pg drops
  // the broken client itself), and off Vercel a read whose connection timed out or was reset runs once more
  pool.on("error", (err) => console.error(poolErrorLine(err)));
  if (!process.env.VERCEL) (pool as unknown as { query: (...a: unknown[]) => Promise<unknown> }).query = withReadRetry(pool.query.bind(pool) as (...a: unknown[]) => Promise<unknown>);
  // PEEK_QUERY_LOG=<file> (measuring only): one JSON line per query with its start and end, so
  // docs/perf.md can count a page's queries and round-trip waves. Off unless set; never on Vercel.
  const logFile = process.env.PEEK_QUERY_LOG?.trim();
  if (logFile && !process.env.VERCEL) {
    const { appendFileSync } = await import("node:fs");
    const orig = pool.query.bind(pool) as (...a: unknown[]) => Promise<unknown>;
    (pool as unknown as { query: (...a: unknown[]) => Promise<unknown> }).query = (...a: unknown[]) => {
      const t0 = performance.now();
      const text = typeof a[0] === "string" ? a[0] : String((a[0] as { text?: string })?.text ?? "");
      const p = orig(...a);
      const done = (rows: number) => appendFileSync(logFile, JSON.stringify({ t0, t1: performance.now(), rows, sql: text.slice(0, 160) }) + "\n");
      p.then((r) => done(Number((r as { rowCount?: number })?.rowCount ?? 0)), () => done(-1));
      return p;
    };
  }
  // Never attached any more. attachDatabasePool held each Vercel function open (waitUntil) until the pool's idle
  // clients closed -- with a five-minute timeout, ~300 s billed per request -- and soft-blocked the team on 11-15.
  if (plan.attachToVercel) (await import("@vercel/functions")).attachDatabasePool(pool);
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
