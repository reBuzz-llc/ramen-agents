// Apply the Drizzle migrations to the database before the app starts: Vercel's build runs it ("npm run migrate"), and
// so does `npm run start` on this Mac. The app itself no longer migrates on a cold start (that cost ~4.5 s a start).
// Uses the direct (unpooled) URL: migrations need a session the pooler would drop. No database URL: nothing to do here
// (local development on PGlite migrates itself when it opens).
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "").trim();
if (!url) {
  console.log("migrate: no DATABASE_URL, nothing to do (PGlite migrates itself)");
  process.exit(0);
}
const client = new pg.Client({ connectionString: url });
const t = Date.now();
try {
  await client.connect();
  // a database the starter's older portal branch made needs its own 0036 bridged first (lib/db/portal-bridge.mjs)
  const { bridgePortal } = await import("../lib/db/portal-bridge.mjs");
  if ((await bridgePortal((text, params) => client.query(text, params))) === "bridged") console.log("migrate: a portal database: its own 0036 bridged, Peek's migrations follow");
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  const { rows } = await client.query("select count(*)::int as n from drizzle.__drizzle_migrations");
  console.log(`migrate: up to date, ${rows[0].n} migrations applied (${Date.now() - t} ms)`);
} catch (err) {
  console.error("migrate: failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
