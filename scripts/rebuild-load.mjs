// Rebuild the portal's data from a dataset (when the database is lost, or moves to another host and only the agents'
// records remain): one JSON object per line in <dir>/{leads,tasks,assets,people}-rebuild-<stamp>.jsonl
//   leads-rebuild-<stamp>.jsonl   {id, notion_page_id, created_at, archived, fields: {<API key>: {value, source, at} | value}}
//   tasks-rebuild-<stamp>.jsonl   the same, with the task board's keys
//   assets-rebuild-<stamp>.jsonl  {kind: rate|package|section, position, ...} (a section's own kind as section_kind)
//   people-rebuild-<stamp>.jsonl  {email, name, role} (optional: else common-data/team.json and --owner-email)
// (examples/rebuild/ has a tiny set) and this loads them into a portal database, as the portal itself would store them:
//   - one company (--tenant, default "team"), its people (the owner as owner);
//   - leads and tasks upserted by id, keeping the dataset's ids and created_at; the derived columns (a lead's domain,
//     city and state) computed as lib/leads.ts does; each new or changed row gets a fresh rev (so the readers' since=
//     works) and one History entry "rebuilt from <sources> on <date>";
//   - a mirrored "What we have" page split into its sections, its Rates block the rate card; packages as given;
//   - the agents' API keys: only their SHA-256 is stored, and the plain keys are in <keys>/peek-*.key, so the same
//     hashes go in and every agent's key works unchanged.
// Idempotent: a second run with the same files changes nothing. Ends with a count per table and column.
//
//   node scripts/rebuild-load.mjs --database-url URL [--dir ~/bots/common-data/backups] [--stamp <stamp>]
//        [--owner-email you@example.com] [--tenant team] [--dry-run]
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sectionsFrom as sectionsFromMirror } from "./seed-sections.mjs";

const BOTS = process.env.BOTS_DIR || path.join(homedir(), "bots");
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const KEY_SCOPES = {
  engine: ["board:read", "board:write"],
  backfill: ["board:read", "board:write", "board:import"],
  validator: ["board:read", "board:write", "board:validate"],
  dashboard: ["board:read"],
  owner: ["board:read", "assets:write"],
};
// lib/leads.ts: derived columns and the cells a write may not set directly
const DERIVED = new Set(["id", "tenant_id", "domain", "city", "state", "rev", "created_at", "updated_at", "last_actor_name", "last_actor_kind"]);

// ---- the derived lead columns, as lib/leads.ts domainOf and lib/lead-filters.ts placeOf compute them --------------------
export function domainOf(website) {
  if (!website) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
const STATES = { "new york": "NY", "n.y.": "NY", ny: "NY", california: "CA", florida: "FL", michigan: "MI", "new jersey": "NJ", texas: "TX", "united kingdom": "UK", england: "UK" };
// the same list as lib/lead-filters.ts (tests/rebuild-load.test.ts compares the two)
const NYC = /^(brooklyn|queens|manhattan|bronx|the bronx|staten island|new york|new york city|nyc|ridgewood|astoria|flushing|jamaica|long island city)$/i;
export function placeOf(location) {
  const parts = String(location ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { city: "", state: "" };
  const city = parts[0];
  for (const p of parts.slice(1)) {
    const word = p.replace(/\s*\d{5}(-\d{4})?$/, "").trim().toLowerCase();
    if (STATES[word]) return { city, state: STATES[word] };
    if (/^[a-z]{2}$/i.test(word) && !/^(us)$/i.test(word)) return { city, state: word.toUpperCase() };
  }
  return { city, state: NYC.test(city) ? "NY" : "" };
}

// ---- reading the dataset -----------------------------------------------------------------------------------------
/** The newest stamp present for leads (or the one asked), and the four files of that stamp (missing ones null). */
export function datasetFiles(dir, stamp) {
  const names = existsSync(dir) ? readdirSync(dir) : [];
  const stamps = names.map((n) => /^leads-rebuild-(.+)\.jsonl$/.exec(n)?.[1]).filter(Boolean).sort();
  const s = stamp || stamps[stamps.length - 1];
  if (!s) return null;
  const f = (kind) => (names.includes(`${kind}-rebuild-${s}.jsonl`) ? path.join(dir, `${kind}-rebuild-${s}.jsonl`) : null);
  return { stamp: s, leads: f("leads"), tasks: f("tasks"), assets: f("assets"), people: f("people") };
}
export const readJsonl = (file) =>
  file
    ? readFileSync(file, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l, i) => {
          try {
            return JSON.parse(l);
          } catch {
            throw new Error(`${path.basename(file)} line ${i + 1} is not JSON`);
          }
        })
    : [];

/** A cell's value and source, from {value, source, at} or a plain value. */
export const cellOf = (v) => (v && typeof v === "object" && !Array.isArray(v) && "value" in v ? { value: v.value, source: String(v.source ?? ""), at: v.at ?? null } : { value: v, source: "", at: null });

/** A value for a column of this Postgres type, as the portal stores it: empty text and empty lists are null. */
export function toColumn(type, v) {
  if (v === undefined || v === null || v === "") return null;
  switch (type) {
    case "ARRAY": {
      const list = (Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim()).filter(Boolean);
      return list.length ? list : null;
    }
    case "jsonb":
    case "json":
      return typeof v === "string" ? JSON.parse(v) : v;
    case "double precision":
    case "integer":
    case "bigint":
    case "numeric": {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case "boolean":
      return v === true || v === "true" || v === 1;
    case "date":
      return String(v).slice(0, 10);
    case "timestamp with time zone":
      return new Date(v).toISOString();
    default: {
      const s = String(v).trim();
      return s || null;
    }
  }
}
/** JSON with object keys sorted: jsonb stores keys in its own order, so the comparison must not depend on it. */
const canon = (v) => JSON.stringify(v ?? null, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const same = (a, b) => canon(a) === canon(b);
const pad = (n) => String(n).padStart(2, "0");
/** A database value as the dataset writes it: a date column (node-postgres reads it as a local Date) as YYYY-MM-DD, a
 *  timestamp as ISO. */
const norm = (type, v) => {
  if (v instanceof Date) return type === "date" ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : v.toISOString();
  return type === "date" && v ? String(v).slice(0, 10) : v;
};

// ---- the load -------------------------------------------------------------------------------------------------------
async function columnsOf(client, table) {
  const { rows } = await client.query("select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1", [table]);
  return new Map(rows.map((r) => [r.column_name, r.data_type]));
}

const BATCH = 500; // rows per insert statement (a remote load in seconds, not half an hour)
const quote = (n) => `"${n}"`;

/** Insert rows in batches of BATCH, rows with the same columns together (a multi-row VALUES cannot leave a column to
 *  its default for some rows only). */
async function insertMany(client, table, rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = Object.keys(r).join(",");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, list] of groups) {
    const names = key.split(",");
    for (let i = 0; i < list.length; i += BATCH) {
      const args = [];
      const tuples = list.slice(i, i + BATCH).map((r) => `(${names.map((n) => (args.push(r[n]), `$${args.length}`)).join(", ")})`);
      await client.query(`insert into ${table} (${names.map(quote).join(", ")}) values ${tuples.join(", ")}`, args);
    }
  }
}

/** Upsert one board's rows; returns {inserted, changed, unchanged, skipped, cells: {column: n}}. The stored rows are
 *  read once and matched in memory; new rows and their History entries go in BATCH at a time; the board commits on its
 *  own, so a stop never leaves one long transaction open. */
async function loadBoard(client, { table, cellsTable, idCol, tenant, rows, today, dry }) {
  const cols = await columnsOf(client, table);
  const report = { inserted: 0, changed: 0, unchanged: 0, skipped: 0, cells: {} };
  // what is stored: by id, by Notion page, and (tasks without either) by title, oldest first
  const stored = (await client.query(`select * from ${table} where tenant_id = $1 order by created_at, rev`, [tenant])).rows;
  const byId = new Map(stored.map((r) => [r.id, r]));
  const byNotion = new Map(stored.filter((r) => r.notion_page_id).map((r) => [r.notion_page_id, r]));
  const byTitle = new Map();
  if (table === "tasks") for (const r of stored.filter((x) => !x.notion_page_id)) byTitle.set(r.title, [...(byTitle.get(r.title) ?? []), r]);
  const taken = new Set(); // each stored row answers one dataset row per run (two tasks may share a title)
  const inserts = [];
  const history = [];
  const updates = [];
  for (const row of rows) {
    const fields = row.fields ?? {};
    const values = {};
    const sources = new Set();
    for (const [k, raw] of Object.entries(fields)) {
      if (!cols.has(k) || DERIVED.has(k)) continue;
      const c = cellOf(raw);
      values[k] = toColumn(cols.get(k), c.value);
      if (c.source) sources.add(c.source);
    }
    if (row.archived !== undefined) values.archived = !!row.archived;
    if (table === "leads") {
      if (!values.business) {
        report.skipped++;
        continue;
      }
      if ("website" in values) values.domain = domainOf(values.website);
      if ("location" in values) {
        const p = values.location ? placeOf(values.location) : null;
        values.city = p?.city || null;
        values.state = p?.state || null;
      }
    } else if (!values.title) {
      report.skipped++;
      continue;
    }
    if (row.notion_page_id) values.notion_page_id = String(row.notion_page_id);
    const id = row.id && /^[0-9a-f-]{36}$/i.test(row.id) ? row.id : null;
    // the row by its id, else its Notion page, else (a task the dataset has no id for) its title: a second run finds
    // what the first one wrote
    let found = id ? byId.get(id) : values.notion_page_id ? byNotion.get(values.notion_page_id) : undefined;
    if (!found && !id && !values.notion_page_id && table === "tasks") found = (byTitle.get(values.title) ?? []).find((r) => !taken.has(r.id));
    if (found && taken.has(found.id)) found = undefined;
    if (found) taken.add(found.id);
    const note = { note: `rebuilt from ${[...sources].join(", ") || "the dataset"} on ${today}` };
    const asParam = (k) => (cols.get(k) === "jsonb" ? JSON.stringify(values[k]) : values[k]);
    const entry = (rowId, columns) => ({ tenant_id: tenant, [idCol]: rowId, column: "rebuilt", new: JSON.stringify({ ...note, columns }), actor_kind: "bot", actor_name: "rebuild", via: "rebuild-load" });
    if (found) {
      const diff = Object.keys(values).filter((k) => !same(norm(cols.get(k), found[k]), values[k]));
      if (!diff.length) {
        report.unchanged++;
        continue;
      }
      report.changed++;
      for (const k of diff) report.cells[k] = (report.cells[k] ?? 0) + 1;
      updates.push({ id: found.id, diff, args: diff.map(asParam) });
      history.push(entry(found.id, diff));
      continue;
    }
    report.inserted++;
    for (const k of Object.keys(values)) if (values[k] !== null) report.cells[k] = (report.cells[k] ?? 0) + 1;
    const newId = id ?? randomUUID();
    taken.add(newId);
    const ins = { tenant_id: tenant, id: newId };
    if (row.created_at) ins.created_at = new Date(row.created_at).toISOString();
    for (const k of Object.keys(values)) ins[k] = asParam(k);
    ins.last_actor_name = "rebuild";
    ins.last_actor_kind = "bot";
    inserts.push(ins);
    history.push(entry(newId, Object.keys(values)));
  }
  if (dry) return report;
  await client.query("begin");
  try {
    await insertMany(client, table, inserts);
    for (const u of updates) {
      const set = u.diff.map((k, i) => `${quote(k)} = $${i + 2}`).join(", ");
      await client.query(`update ${table} set ${set}, updated_at = now(), rev = nextval('${table}_rev_seq'), last_actor_name = 'rebuild', last_actor_kind = 'bot' where id = $1`, [u.id, ...u.args]);
    }
    await insertMany(client, cellsTable, history);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  }
  return report;
}

/** The asset lists: each kind replaced as a whole when the dataset's list differs from the database's. */
/** A section that is a whole mirrored page (its body has "## " headings: the-ceo/raw/what-we-have.md) becomes the
 *  page's sections, as scripts/seed-sections.mjs reads the mirror, and its Rates block's "- " lines the rate card (when
 *  the dataset has no rate records). A "packages-page" section is left out: its packages come as package records. */
export function expandMirror(items) {
  const out = [];
  const rates = [];
  for (const x of items) {
    if (x.kind === "section" && /^packages-page$/i.test(String(x.title ?? ""))) continue;
    if (x.kind === "section" && /^##\s/m.test(String(x.body ?? ""))) {
      const body = String(x.body);
      const block = /^##\s+Rates[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(body)?.[1] ?? "";
      for (const l of block.split("\n")) if (/^\s*[-*]\s+\S/.test(l)) rates.push(l.replace(/^\s*[-*]\s+/, "").trim());
      const header = /^(Last (edited on Notion|changed on [^:]+):|What the company actually has)/;
      for (const s of sectionsFromMirror(body)) {
        // the untitled first section loses the mirror's header lines; the Rates section its note about where rates live
        const sbody = (s.title ? s.body : s.body.split("\n").filter((l) => !header.test(l)).join("\n"))
          .split("\n")
          .filter((l) => !(s.kind === "rates" && /^From .+ Asset page/.test(l)))
          .join("\n")
          .trim();
        if (s.title || sbody) out.push({ kind: "section", title: s.title, section_kind: s.kind, body: sbody, source: x.source });
      }
    } else out.push(x);
  }
  if (rates.length && !items.some((x) => x.kind === "rate")) rates.forEach((line, i) => out.push({ kind: "rate", position: i + 1, line }));
  return out.map((x, i) => (x.kind === "section" ? { ...x, position: i } : x));
}

/** No rate records but a section titled "Rates" (the mirror's What we have): its "- " lines become the rate card and
 *  the section shows it (section_kind "rates"), as scripts/seed-sections.mjs does. */
export function splitRates(items) {
  if (items.some((x) => x.kind === "rate")) return items;
  const out = [];
  let pos = 0;
  for (const x of items) {
    if (x.kind === "section" && /^rates$/i.test(String(x.title ?? "").trim())) {
      const lines = String(x.body ?? "").split("\n");
      const rates = lines.filter((l) => /^\s*[-*]\s+\S/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, "").trim());
      for (const line of rates) out.push({ kind: "rate", position: ++pos, line });
      out.push({ ...x, section_kind: "rates", body: lines.filter((l) => !/^\s*[-*]\s+\S/.test(l) && !/^From .+ Asset page/.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim() });
    } else out.push(x);
  }
  return out;
}

async function loadAssets(client, tenant, rawItems, dry) {
  const items = splitRates(expandMirror(rawItems));
  const out = {};
  const plan = {
    rate: { table: "asset_rates", cols: ["line"] },
    package: { table: "asset_packages", cols: ["name", "price", "offer", "buyer", "deliverables", "status", "email", "why", "sources"] },
    section: { table: "asset_sections", cols: ["title", "kind", "body"] },
  };
  for (const [kind, p] of Object.entries(plan)) {
    const want = items
      .filter((x) => x.kind === kind)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((x) =>
        Object.fromEntries(
          p.cols.map((c) => {
            // a section's own kind ("text" or "rates") rides as section_kind: "kind" names the record (rate, package, section)
            if (c === "kind") return [c, x.section_kind === "rates" ? "rates" : "text"];
            if (c === "deliverables" || c === "sources") return [c, Array.isArray(x[c]) ? x[c] : []];
            if (c === "status") return [c, x.status === "published" ? "published" : "draft"];
            return [c, x[c] === undefined || x[c] === null ? "" : String(x[c])];
          }),
        ),
      );
    if (!want.length) {
      out[p.table] = "none in the dataset (kept)";
      continue;
    }
    const { rows } = await client.query(`select ${p.cols.map((c) => `"${c}"`).join(", ")} from ${p.table} where tenant_id = $1 order by position`, [tenant]);
    if (same(rows, want)) {
      out[p.table] = `${want.length} unchanged`;
      continue;
    }
    out[p.table] = `${want.length} written (was ${rows.length})`;
    if (dry) continue;
    await client.query(`delete from ${p.table} where tenant_id = $1`, [tenant]);
    for (const [i, w] of want.entries()) {
      await client.query(`insert into ${p.table} (tenant_id, position, ${p.cols.map((c) => `"${c}"`).join(", ")}, updated_by) values ($1, $2, ${p.cols.map((_, j) => `$${j + 3}`).join(", ")}, 'rebuild')`, [tenant, i + 1, ...p.cols.map((c) => w[c])]);
    }
  }
  return out;
}

export async function rebuild({ client, dir, stamp, ownerEmail, tenantSlug = "team", dry = false, keysDir = path.join(BOTS, "common-data", "keys"), teamFile = path.join(BOTS, "common-data", "team.json"), today = new Date().toISOString().slice(0, 10) }) {
  const files = datasetFiles(dir, stamp);
  if (!files) throw new Error(`no leads-rebuild-<stamp>.jsonl in ${dir}`);
  const report = { stamp: files.stamp, files: Object.fromEntries(Object.entries(files).filter(([k]) => k !== "stamp").map(([k, v]) => [k, v ? path.basename(v) : "none"])) };
  await client.query("begin");
  try {
    // the company
    let { rows: t } = await client.query("select id from tenants where slug = $1", [tenantSlug]);
    if (!t[0]) {
      if (!dry) t = (await client.query("insert into tenants (name, slug) values ($1, $2) returning id", [tenantSlug, tenantSlug])).rows;
      else t = [{ id: "00000000-0000-0000-0000-000000000000" }];
      report.tenant = `created ${tenantSlug}`;
    } else report.tenant = `kept ${tenantSlug}`;
    const tenant = t[0].id;
    report.tenantId = tenant;
    // the people: the dataset's file, else the team list and the owner
    let people = readJsonl(files.people);
    if (!people.length) {
      const team = existsSync(teamFile) ? JSON.parse(readFileSync(teamFile, "utf8")).members ?? [] : [];
      people = team.filter((m) => m.email).map((m) => ({ email: m.email, name: m.name, role: "member" }));
    }
    if (ownerEmail) people = [{ email: ownerEmail, name: "", role: "owner" }, ...people.filter((p) => p.email.toLowerCase() !== ownerEmail.toLowerCase())];
    let added = 0;
    for (const p of people) {
      const email = String(p.email).trim().toLowerCase();
      if (!email.includes("@")) continue;
      const role = ["owner", "manager", "member"].includes(p.role) ? p.role : "member";
      const { rows: u } = await client.query("select id from users where tenant_id = $1 and email = $2", [tenant, email]);
      if (u[0]) continue;
      added++;
      if (!dry) await client.query("insert into users (tenant_id, email, name, role) values ($1, $2, $3, $4)", [tenant, email, String(p.name ?? ""), role]);
    }
    report.people = `${added} added, ${people.length - added} already there`;
    // the API keys: the same hashes, so every key file keeps working
    const keyReport = [];
    for (const [name, scopes] of Object.entries(KEY_SCOPES)) {
      const f = path.join(keysDir, `peek-${name}.key`);
      if (!existsSync(f)) {
        keyReport.push(`${name}: no key file`);
        continue;
      }
      const token = readFileSync(f, "utf8").trim();
      const { rows: k } = await client.query("select id from api_keys where key_hash = $1", [sha256(token)]);
      if (k[0]) {
        keyReport.push(`${name}: kept`);
        continue;
      }
      keyReport.push(`${name}: restored`);
      if (!dry) await client.query("insert into api_keys (tenant_id, name, key_hash, scopes) values ($1, $2, $3, $4)", [tenant, name, sha256(token), scopes]);
    }
    report.keys = keyReport.join("; ");
    // the company, its people and its keys commit first; then each board on its own, then the assets
    await client.query(dry ? "rollback" : "commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  }
  const tenantId = report.tenantId;
  report.leads = await loadBoard(client, { table: "leads", cellsTable: "lead_cells", idCol: "lead_id", tenant: tenantId, rows: readJsonl(files.leads), today, dry });
  report.tasks = await loadBoard(client, { table: "tasks", cellsTable: "task_cells", idCol: "task_id", tenant: tenantId, rows: readJsonl(files.tasks), today, dry });
  await client.query("begin");
  try {
    report.assets = await loadAssets(client, tenantId, readJsonl(files.assets), dry);
    await client.query(dry ? "rollback" : "commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  }
  delete report.tenantId;
  return report;
}

function print(r) {
  console.log(`dataset ${r.stamp}: ${Object.entries(r.files).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`company: ${r.tenant}; people: ${r.people}`);
  console.log(`API keys: ${r.keys}`);
  for (const b of ["leads", "tasks"]) {
    const x = r[b];
    console.log(`${b}: ${x.inserted} inserted, ${x.changed} changed, ${x.unchanged} unchanged, ${x.skipped} skipped (no ${b === "leads" ? "business" : "title"})`);
    const cells = Object.entries(x.cells).sort((a, b) => b[1] - a[1]);
    if (cells.length) console.log(`  cells written: ${cells.map(([k, n]) => `${k} ${n}`).join(", ")}`);
  }
  console.log(`assets: ${Object.entries(r.assets).map(([k, v]) => `${k} ${v}`).join("; ")}`);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const dir = opt("--dir", path.join(BOTS, "common-data", "backups"));
  const keyFile = path.join(BOTS, "common-data", "keys", "portal-local.key");
  const url = opt("--database-url", existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "");
  if (!url) throw new Error("no database: --database-url, or common-data/keys/portal-local.key (the fleet's scripts/portal-local-setup.sh)");
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const r = await rebuild({ client, dir, stamp: opt("--stamp"), ownerEmail: opt("--owner-email"), tenantSlug: opt("--tenant", "team"), dry: args.includes("--dry-run") });
    if (args.includes("--dry-run")) console.log("dry run: nothing written");
    print(r);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
