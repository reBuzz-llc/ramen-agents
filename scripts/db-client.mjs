// A database client for the scripts that write to Peek's database directly (api-key.mjs, rebuild-load.mjs):
// node-postgres on a database address, or PGlite in a folder (--pglite <folder>) for a local install with sign-in off.
// PGlite lets one process at a time open a folder, so it refuses while Peek answers on its port (PEEK_PORT, else 3100),
// and refuses a folder that holds no database yet (start Peek once, then stop it). Both clients answer query(text,
// params) with {rows, rowCount} and end().
import { existsSync } from "node:fs";
import path from "node:path";

export async function openClient({ url = "", pglite = "", port = process.env.PEEK_PORT || "3100", up = peekAnswers } = {}) {
  if (url) {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    return client;
  }
  if (!pglite) throw new Error("no database: give a database address, or --pglite <folder> for a local install");
  if (await up(port)) throw new Error(`Peek is running on port ${port}: stop it first (PGlite lets one process at a time open its folder)`);
  if (!existsSync(path.join(pglite, "PG_VERSION"))) throw new Error(`${pglite} holds no Peek database yet: start Peek once with sign-in off, then stop it`);
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(pglite);
  return {
    async query(text, params) {
      const r = await db.query(text, params);
      return { rows: r.rows, rowCount: r.affectedRows || r.rows.length };
    },
    end: () => db.close(),
  };
}

/** Does something answer Peek's health check on this computer's port? */
export async function peekAnswers(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}
