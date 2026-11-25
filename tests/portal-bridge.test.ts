// A database the starter's older portal branch made moves to Peek's migrations without losing a row (lib/db/portal-bridge.mjs).
// Two November installs are rebuilt here from the portal's own journal: one at 0035 (before its own 0036), one at its
// 0036_drop_notion. Each gets rows, then opens the way Peek opens a local database. Afterwards every row is there and the
// schema is exactly a new Peek database's. Peek's own database and a new one are left alone.
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { bridgePortal, PORTAL_0036 } from "@/lib/db/portal-bridge.mjs";

const PEEK = path.join(process.cwd(), "drizzle");
const FIX = path.join(process.cwd(), "tests", "fixtures", "portal-november");
const dirs: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(path.join(tmpdir(), p));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

type Q = { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
const lite = (db: unknown) => (db as { $client: PGlite }).$client;

/** The portal's migrations folder as a November install had it, up to and with entry `last` of its journal. */
function portalFolder(last: number): string {
  const dir = tmp("portal-mig-");
  mkdirSync(path.join(dir, "meta"));
  const journal = JSON.parse(readFileSync(path.join(FIX, "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  journal.entries = journal.entries.filter((e) => e.idx <= last);
  writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify(journal));
  for (const e of journal.entries) {
    const own = path.join(FIX, `${e.tag}.sql`);
    copyFileSync(e.idx === 36 ? own : path.join(PEEK, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  }
  return dir;
}

/** A November install: the portal's chain up to `last`, then a company, its owner, a member, two leads and a task. */
async function november(last: number): Promise<string> {
  const data = tmp("portal-db-");
  const pg = new PGlite(data);
  await migrate(drizzle(pg), { migrationsFolder: portalFolder(last) });
  const [t] = (await pg.query<{ id: string }>(`insert into tenants (name, slug) values ('Acme', 'acme') returning id`)).rows;
  await pg.query(`insert into users (tenant_id, email, name, role) values ($1, 'o@acme.example', 'Olu', 'owner'), ($1, 'm@acme.example', 'Mina', 'member')`, [t.id]);
  await pg.query(`insert into leads (tenant_id, business, website, notes) values ($1, 'Acme Bakery', 'https://acmebakery.example', 'call after 3'), ($1, 'Bun Shop', null, null)`, [t.id]);
  await pg.query(`insert into tasks (tenant_id, title) values ($1, 'Write the welcome email')`, [t.id]);
  await pg.close();
  return data;
}

/** What a database is: its tables' columns, its indexes and its constraints, in a fixed order. */
async function shape(q: Q) {
  const cols = await q.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' order by 1, 2`);
  const idx = await q.query(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`);
  const cons = await q.query(`select conrelid::regclass::text as t, conname, contype from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`);
  return { cols: cols.rows, idx: idx.rows, cons: cons.rows };
}

const rowsOf = async (q: Q) => ({
  tenants: (await q.query(`select name, slug from tenants order by slug`)).rows,
  users: (await q.query(`select email, name, role from users order by email`)).rows,
  leads: (await q.query(`select business, website, notes from leads order by business`)).rows,
  tasks: (await q.query(`select title from tasks`)).rows,
});

describe("a November portal database opens on Peek's migrations", () => {
  it.each([
    [35, "before the portal's own 0036", "none"],
    [36, "at the portal's own 0036_drop_notion", "bridged"],
  ])("at %i (%s): every row stays and the schema becomes a new Peek database's", async (last, _what, bridged) => {
    const data = await november(last);
    const before = new PGlite(data);
    const rows = await rowsOf(before);
    expect(await bridgePortal((t: string, p?: unknown[]) => before.query(t, p))).toBe(bridged);
    await before.close();
    const db = await memoryDb(data);
    const q = lite(db);
    expect(await rowsOf(q)).toEqual(rows);
    expect(rows.leads).toHaveLength(2);
    const fresh = lite(await memoryDb());
    expect(await shape(q)).toEqual(await shape(fresh));
    const applied = (await q.query<{ n: number }>(`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows[0].n;
    expect(applied).toBe(readdirSync(PEEK).filter((f) => f.endsWith(".sql")).length);
    expect((await q.query(`select 1 from drizzle.__drizzle_migrations where hash = $1`, [PORTAL_0036.hash])).rows).toEqual([]);
    expect(await bridgePortal((t: string, p?: unknown[]) => q.query(t, p))).toBe("none");
    await q.close();
  }, 120_000);

  it("without the bridge, Peek's migrations fail on a database at the portal's own 0036", async () => {
    const pg = new PGlite(await november(36));
    await expect(migrate(drizzle(pg), { migrationsFolder: PEEK })).rejects.toThrow();
    await pg.close();
  }, 120_000);

  it("Peek's own database and a new, empty one are left alone", async () => {
    const peek = lite(await memoryDb());
    expect(await bridgePortal((t: string, p?: unknown[]) => peek.query(t, p))).toBe("none");
    const empty = new PGlite();
    expect(await bridgePortal((t: string, p?: unknown[]) => empty.query(t, p))).toBe("new");
    await empty.close();
  });

  it("the bridge knows the portal's 0036 by its own file", async () => {
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(readFileSync(path.join(FIX, "0036_drop_notion.sql"), "utf8")).digest("hex")).toBe(PORTAL_0036.hash);
    const entry = (JSON.parse(readFileSync(path.join(FIX, "_journal.json"), "utf8")) as { entries: { idx: number; when: number }[] }).entries.find((e) => e.idx === 36);
    expect(entry?.when).toBe(PORTAL_0036.createdAt);
  });

  it("migrate.mjs bridges before it migrates", () => {
    const src = readFileSync(path.join(process.cwd(), "scripts", "migrate.mjs"), "utf8");
    expect(src.indexOf("bridgePortal(")).toBeGreaterThan(0);
    expect(src.indexOf("bridgePortal(")).toBeLessThan(src.indexOf("await migrate("));
  });
});
