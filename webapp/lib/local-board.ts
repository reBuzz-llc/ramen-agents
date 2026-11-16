// The local board (queue 572, owner 2026-11-16: the starter is local-first, no Notion, no account): the Leads, Tasks and
// Packages boards in one SQLite file on this Mac, common-data/local-board.sqlite3 (git-ignored), served by this dashboard
// with the same paths and answers as the hosted portal's board API (app/v1/...). The agents (the engine's
// portal_store), the Validator and these pages read and write the same rows, so a later move to the hosted portal is a
// change of [leads] portal_url, nothing else.
//
// The rules are the portal's:
//   - a cell the team keeps (status, sent by, result ...) is refused to an agent: "human_only";
//   - a cell a person wrote last is refused to an agent: "person_wins";
//   - with fill_only, a filled cell is left: "filled";
//   - domain, city and state are worked out from website and location: a write to one is "derived";
//   - one lead per business: the same website domain (or, with no website, the same business name) is "duplicate_row".
// Every applied and refused cell is kept in `history`. Each write takes the board's next revision, so a reader asks for
// the rows changed since the revision it holds (?since=), and an ETag on the newest revision answers 304 when nothing moved.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
const BOTS_DIR = process.env.BOTS_DIR ?? path.join(homedir(), "bots"); // as lib/bots.ts (no import: Node's test runner loads this file)

export type Board = "leads" | "tasks" | "packages" | "rates";
type Kind = "text" | "list" | "number" | "bool" | "date" | "json";
export type FieldSpec = { key: string; kind: Kind; human?: boolean; label: string };

/** The Leads board's cells: the engine's PORTAL_FIELDS keys (src/explorer/portal_store.py) and the team's own. */
export const LEAD_FIELDS: FieldSpec[] = [
  { key: "business", kind: "text", label: "Business" },
  { key: "website", kind: "text", label: "Website" },
  { key: "business_email", kind: "text", label: "Business email" },
  { key: "email_check", kind: "text", label: "Email check" },
  { key: "phone", kind: "text", label: "Phone" },
  { key: "whatsapp", kind: "text", label: "WhatsApp" },
  { key: "location", kind: "text", label: "Location" },
  { key: "map_link", kind: "text", label: "Map link" },
  { key: "industry", kind: "text", label: "Industry" },
  { key: "size", kind: "text", label: "Company size" },
  { key: "contact_person", kind: "text", label: "Contact person" },
  { key: "contact_role", kind: "text", label: "Contact role" },
  { key: "founder_linkedin", kind: "text", label: "Founder LinkedIn" },
  { key: "linkedin_via", kind: "text", label: "LinkedIn found via" },
  { key: "pain_point", kind: "text", label: "Pain point" },
  { key: "package", kind: "text", label: "How we can help" },
  { key: "evidence", kind: "text", label: "Evidence" },
  { key: "source_pages", kind: "text", label: "Source pages" },
  { key: "tools_on_site", kind: "list", label: "Tools on site" },
  { key: "site_health", kind: "text", label: "Site health" },
  { key: "lead_score", kind: "number", label: "Lead score" },
  { key: "draft_email", kind: "text", label: "Draft email" },
  { key: "draft_whatsapp", kind: "text", label: "Draft WhatsApp" },
  { key: "status", kind: "list", human: true, label: "Status" },
  { key: "email_status", kind: "text", human: true, label: "Email status" },
  { key: "whatsapp_status", kind: "text", human: true, label: "WhatsApp status" },
  { key: "result", kind: "text", human: true, label: "Result" },
  { key: "result_date", kind: "date", human: true, label: "Result date" },
  { key: "sent_by", kind: "list", human: true, label: "Sent by" },
  { key: "notes", kind: "text", label: "Notes" },
];
/** The Tasks board's cells (the portal's tasks): a bot's task starts "Not started", unassigned. */
export const TASK_FIELDS: FieldSpec[] = [
  { key: "title", kind: "text", label: "Title" },
  { key: "status", kind: "text", human: true, label: "Status" },
  { key: "priority", kind: "text", label: "Priority" },
  { key: "assignees", kind: "list", human: true, label: "Assignees" },
  { key: "due", kind: "date", label: "Due" },
  { key: "projects", kind: "list", label: "Projects" },
  { key: "blocker", kind: "text", label: "Blocker" },
  { key: "files", kind: "list", label: "Files" },
  { key: "details", kind: "text", label: "Details" },
  { key: "checklist", kind: "json", human: true, label: "Checklist" },
  { key: "standing", kind: "bool", label: "Standing" },
];
/** The Packages list (the portal's asset list): an agent hands a package over as a draft; a person prices and publishes. */
export const PACKAGE_FIELDS: FieldSpec[] = [
  { key: "name", kind: "text", label: "Name" },
  { key: "price", kind: "text", label: "Price" },
  { key: "offer", kind: "text", label: "Offer" },
  { key: "buyer", kind: "text", label: "Buyer" },
  { key: "deliverables", kind: "text", label: "Deliverables" },
  { key: "why", kind: "text", label: "Why" },
  { key: "sources", kind: "text", label: "Sources" },
  { key: "status", kind: "text", human: true, label: "Status" },
  { key: "by", kind: "text", label: "Handed over by" },
  { key: "reviewed_by", kind: "text", label: "Reviewed by" },
  { key: "reviewed_at", kind: "text", label: "Reviewed at" },
  { key: "review_verdict", kind: "text", label: "Review" },
  { key: "review_note", kind: "text", label: "Review note" },
];
/** The rate card (the portal's asset list "rates"): what each line of work costs; people edit it, agents read it. */
export const RATE_FIELDS: FieldSpec[] = [
  { key: "line", kind: "text", label: "Line" },
  { key: "offer", kind: "text", label: "Offer" },
  { key: "price", kind: "text", label: "Price" },
];
export const FIELDS: Record<Board, FieldSpec[]> = { leads: LEAD_FIELDS, tasks: TASK_FIELDS, packages: PACKAGE_FIELDS, rates: RATE_FIELDS };
/** Worked out from other cells (website -> domain, location -> city and state); never written directly. */
export const DERIVED = ["domain", "city", "state"];
export const TASK_STATUSES = ["Not started", "In progress", "Done"];
export const FALSE_WHATSAPP = "False Whatsapp Number";

export type Actor = { kind: "person"; name: string } | { kind: "bot"; name: string; validator?: boolean };
export type Refusal = { field: string; reason: "human_only" | "person_wins" | "filled" | "derived"; current: unknown };
export type Row = Record<string, unknown> & { id: string; rev: number };
export type WriteResult =
  | { ok: true; created: boolean; row: Row; written: string[]; refused: Refusal[] }
  | { ok: false; code: "not_found" | "bad_request" | "duplicate_row"; message: string; existingId?: string };

// ---- the file --------------------------------------------------------------------------------------------------------
export const boardFile = () => process.env.LOCAL_BOARD_FILE ?? path.join(BOTS_DIR, "common-data", "local-board.sqlite3");
const g = globalThis as { __localBoard?: { file: string; db: DatabaseSync } };

/** The board's database, opened once per process (created with its tables on first use). */
export function db(): DatabaseSync {
  const file = boardFile();
  if (g.__localBoard?.file === file) return g.__localBoard.db;
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rows (
      id TEXT PRIMARY KEY, board TEXT NOT NULL, rev INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0, cells TEXT NOT NULL DEFAULT '{}', last_by TEXT NOT NULL DEFAULT '{}',
      last_actor TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS rows_board_rev ON rows (board, rev);
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, row_id TEXT NOT NULL, field TEXT NOT NULL, old TEXT, new TEXT,
      actor_kind TEXT NOT NULL, actor_name TEXT NOT NULL, at TEXT NOT NULL, outcome TEXT NOT NULL, reason TEXT);
    CREATE INDEX IF NOT EXISTS history_row ON history (row_id, id);
    CREATE TABLE IF NOT EXISTS tokens (name TEXT PRIMARY KEY, hash TEXT NOT NULL, created_at TEXT NOT NULL);`);
  g.__localBoard = { file, db: d };
  return d;
}
/** Close the database (the tests, between files). */
export function closeBoard(): void {
  g.__localBoard?.db.close();
  g.__localBoard = undefined;
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
function nextRev(d: DatabaseSync): number {
  d.prepare("INSERT INTO meta (k, v) VALUES ('rev', '1') ON CONFLICT(k) DO UPDATE SET v = CAST(v AS INTEGER) + 1").run();
  return Number((d.prepare("SELECT v FROM meta WHERE k = 'rev'").get() as { v: string }).v);
}
/** The newest revision on a board (0 when empty): the ETag's base. */
export function boardRev(board: Board): number {
  const r = db().prepare("SELECT MAX(rev) AS rev FROM rows WHERE board = ?").get(board) as { rev: number | null };
  return Number(r.rev ?? 0);
}

// ---- keys ------------------------------------------------------------------------------------------------------------
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** A new token for `name` (portal-engine, portal-validator, portal-dashboard), stored hashed; the plain value is returned
 *  once, for the key file. A name already holding a token gets a new one. */
export function issueToken(name: string): string {
  const token = randomBytes(24).toString("base64url");
  db().prepare("INSERT INTO tokens (name, hash, created_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET hash = excluded.hash").run(name, sha(token), nowIso());
  return token;
}
/** Make sure the token in a key file is known (setup and the first start: a key file written before the database). */
export function adoptToken(name: string, token: string): void {
  const t = token.trim();
  if (t.length < 16) return;
  db().prepare("INSERT INTO tokens (name, hash, created_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET hash = excluded.hash").run(name, sha(t), nowIso());
}
/** The key's name for a bearer token, or null. */
export function tokenName(token: string): string | null {
  if (!token) return null;
  const r = db().prepare("SELECT name FROM tokens WHERE hash = ?").get(sha(token)) as { name: string } | undefined;
  return r?.name ?? null;
}

// ---- cells -------------------------------------------------------------------------------------------------------------
const MAX_TEXT = 20_000;
function normalise(f: FieldSpec, v: unknown): { value: unknown } | { error: string } {
  if (v === null || v === undefined || v === "") return { value: null };
  switch (f.kind) {
    case "text":
      return { value: String(v).slice(0, MAX_TEXT) };
    case "date": {
      const s = String(v).trim();
      return /^\d{4}-\d\d-\d\d/.test(s) ? { value: s.slice(0, 10) } : { error: `${f.key} is a date (YYYY-MM-DD)` };
    }
    case "number": {
      const n = typeof v === "number" ? v : Number(String(v).trim());
      return Number.isFinite(n) ? { value: n } : { error: `${f.key} is a number` };
    }
    case "bool":
      return { value: v === true || v === "true" || v === 1 };
    case "list": {
      const list = Array.isArray(v) ? v : String(v).split(",");
      const out = list.map((x) => String(x).trim()).filter(Boolean).slice(0, 50);
      return { value: out.length ? out : null };
    }
    case "json":
      return { value: v };
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** "https://www.Example.com/menu" -> "example.com". */
export function domainOf(website: unknown): string | null {
  if (!website) return null;
  try {
    const s = String(website).trim();
    const host = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
/** "Brooklyn, NY 11201" -> {city: "Brooklyn", state: "NY"}; the first two comma parts otherwise. */
export function placeOf(location: unknown): { city: string | null; state: string | null } {
  const parts = String(location ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { city: null, state: null };
  const st = parts[1] ? parts[1].replace(/\s+\d[\d-]*$/, "").trim() : "";
  return { city: parts[0] || null, state: st || null };
}

type Stored = { id: string; board: string; rev: number; created_at: string; updated_at: string; archived: number; cells: string; last_by: string; last_actor: string };
function toRow(s: Stored): Row {
  const cells = JSON.parse(s.cells) as Record<string, unknown>;
  const out: Row = { id: s.id, rev: Number(s.rev), created_at: s.created_at, updated_at: s.updated_at, archived: !!s.archived, last_edited_by: s.last_actor || null, ...cells };
  if (s.board === "leads") {
    out.domain = domainOf(cells.website);
    const p = placeOf(cells.location);
    out.city = p.city;
    out.state = p.state;
  }
  return out;
}
function load(board: Board, id: string): Stored | undefined {
  return db().prepare("SELECT * FROM rows WHERE board = ? AND id = ?").get(board, id) as Stored | undefined;
}
/** One row by id (any board), or null. */
export function getRow(id: string): { board: Board; row: Row } | null {
  const s = db().prepare("SELECT * FROM rows WHERE id = ?").get(id) as Stored | undefined;
  return s ? { board: s.board as Board, row: toRow(s) } : null;
}

/** The rows of a board changed after revision `since`, oldest change first, at most `limit` (1..500). The first read
 *  (since 0) leaves archived rows out unless asked; a later one carries them, so a reader's copy learns of an archive. */
export function listRows(board: Board, o: { since?: number; limit?: number; archived?: boolean; status?: string } = {}) {
  const limit = Math.min(Math.max(Math.floor(o.limit ?? 100), 1), 500);
  const since = Math.max(Math.floor(o.since ?? 0), 0);
  const withArchived = o.archived || since > 0;
  const rows = db()
    .prepare(`SELECT * FROM rows WHERE board = ? AND rev > ? ${withArchived ? "" : "AND archived = 0"} ORDER BY rev ASC LIMIT ?`)
    .all(board, since, limit + 1) as Stored[];
  let page = rows.slice(0, limit).map(toRow);
  if (o.status) page = page.filter((r) => r.status === o.status);
  const last = rows.slice(0, limit).at(-1);
  return { rows: page, next: last ? Number(last.rev) : since, more: rows.length > limit };
}
/** Every live row of a board, newest first (the pages). */
export function allRows(board: Board): Row[] {
  return (db().prepare("SELECT * FROM rows WHERE board = ? AND archived = 0 ORDER BY created_at DESC").all(board) as Stored[]).map(toRow);
}

// ---- the write -----------------------------------------------------------------------------------------------------------
/** Create (`create`) or change one row, by the portal's rules; `fillOnly` leaves filled cells; `import` (a person's CSV)
 *  writes as a person and never overwrites a filled cell. */
export function writeRow(
  board: Board,
  target: { id?: string },
  input: Record<string, unknown>,
  actor: Actor,
  opts: { create?: boolean; fillOnly?: boolean; archive?: boolean } = {},
): WriteResult {
  const spec = new Map(FIELDS[board].map((f) => [f.key, f]));
  const want = new Map<FieldSpec, unknown>();
  const derived: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (["id", "rev", "created_at", "updated_at", "last_edited_by", "notion_page_id"].includes(k)) continue;
    if (DERIVED.includes(k) && board === "leads") {
      derived.push(k);
      continue;
    }
    const f = spec.get(k);
    if (!f) return { ok: false, code: "bad_request", message: `unknown field: ${k}` };
    const n = normalise(f, v);
    if ("error" in n) return { ok: false, code: "bad_request", message: n.error };
    want.set(f, n.value);
  }
  const d = db();
  const now = nowIso();
  const refused: Refusal[] = [];
  const history: [string, string, unknown, unknown, string, string | null][] = []; // field, outcome, old, new, reason
  d.exec("BEGIN IMMEDIATE");
  try {
    const cur = target.id ? load(board, target.id) : undefined;
    let result: WriteResult;
    if (!cur) {
      if (!opts.create) {
        d.exec("ROLLBACK");
        return { ok: false, code: "not_found", message: `no ${board === "leads" ? "lead" : board === "tasks" ? "task" : "package"} ${target.id ?? ""}`.trim() };
      }
      const title = board === "leads" ? "business" : board === "tasks" ? "title" : board === "rates" ? "line" : "name";
      const name = want.get(spec.get(title)!);
      if (!name) {
        d.exec("ROLLBACK");
        return { ok: false, code: "bad_request", message: `a new row needs ${title}` };
      }
      const cells: Record<string, unknown> = {};
      for (const [f, v] of want) {
        if (v === null) continue;
        if (actor.kind === "bot" && f.human) {
          refused.push({ field: f.key, reason: "human_only", current: null });
          history.push([f.key, "refused", null, v, "human_only", null]);
          continue;
        }
        cells[f.key] = v;
      }
      if (board === "tasks" && actor.kind === "bot") cells.status = "Not started";
      if (board === "packages" && actor.kind === "bot") cells.status = "draft";
      if (board === "leads") {
        // one row per business: the same domain, or with no website the same name
        const dom = domainOf(cells.website);
        const others = d.prepare("SELECT * FROM rows WHERE board = 'leads' AND archived = 0").all() as Stored[];
        const dup = others.find((o) => {
          const c = JSON.parse(o.cells) as Record<string, unknown>;
          return dom ? domainOf(c.website) === dom : !c.website && String(c.business ?? "").trim().toLowerCase() === String(name).trim().toLowerCase();
        });
        if (dup) {
          d.exec("ROLLBACK");
          return { ok: false, code: "duplicate_row", message: `${String(name)} is already on the board`, existingId: dup.id };
        }
      }
      const id = randomUUID();
      const lastBy = Object.fromEntries(Object.keys(cells).map((k) => [k, actor.kind]));
      d.prepare("INSERT INTO rows (id, board, rev, created_at, updated_at, archived, cells, last_by, last_actor) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)").run(
        id, board, nextRev(d), now, now, JSON.stringify(cells), JSON.stringify(lastBy), actor.name.slice(0, 80),
      );
      for (const [k, v] of Object.entries(cells)) history.push([k, "applied", null, v, "", null]);
      writeHistory(id, history, actor, now);
      result = { ok: true, created: true, row: toRow(load(board, id)!), written: Object.keys(cells), refused };
    } else {
      const cells = JSON.parse(cur.cells) as Record<string, unknown>;
      const lastBy = JSON.parse(cur.last_by) as Record<string, string>;
      const written: string[] = [];
      for (const [f, v] of want) {
        const old = cells[f.key] ?? null;
        if (same(old, v)) continue;
        let reason: Refusal["reason"] | null = null;
        // the Validator's one exception: it may clear a WhatsApp number the team marked false
        const clears = actor.kind === "bot" && actor.validator && f.key === "whatsapp_status" && old === FALSE_WHATSAPP && v === null;
        if (!clears) {
          if (actor.kind === "bot" && f.human) reason = "human_only";
          else if (actor.kind === "bot" && lastBy[f.key] === "person") reason = "person_wins";
          else if (opts.fillOnly && old !== null) reason = "filled";
        }
        if (reason) {
          refused.push({ field: f.key, reason, current: old });
          history.push([f.key, "refused", old, v, reason, null]);
          continue;
        }
        if (v === null) delete cells[f.key];
        else cells[f.key] = v;
        lastBy[f.key] = actor.kind;
        written.push(f.key);
        history.push([f.key, "applied", old, v, "", null]);
      }
      const archive = opts.archive !== undefined && !!opts.archive !== !!cur.archived;
      if (written.length || archive) {
        d.prepare("UPDATE rows SET cells = ?, last_by = ?, rev = ?, updated_at = ?, last_actor = ?, archived = ? WHERE id = ?").run(
          JSON.stringify(cells), JSON.stringify(lastBy), nextRev(d), now, actor.name.slice(0, 80), archive ? (opts.archive ? 1 : 0) : cur.archived, cur.id,
        );
        if (archive) history.push(["archived", "applied", !!cur.archived, !!opts.archive, "", null]);
      }
      writeHistory(cur.id, history, actor, now);
      result = { ok: true, created: false, row: toRow(load(board, cur.id)!), written, refused };
    }
    d.exec("COMMIT");
    if (result.ok) for (const k of derived) result.refused.push({ field: k, reason: "derived", current: result.row[k] ?? null });
    return result;
  } catch (err) {
    try {
      d.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}
function writeHistory(rowId: string, h: [string, string, unknown, unknown, string, string | null][], actor: Actor, at: string): void {
  const ins = db().prepare("INSERT INTO history (row_id, field, old, new, actor_kind, actor_name, at, outcome, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const [field, outcome, old, nw, reason] of h) ins.run(rowId, field, JSON.stringify(old ?? null), JSON.stringify(nw ?? null), actor.kind, actor.name.slice(0, 80), at, outcome, reason || null);
}
/** A row's change history, newest first. */
export function rowHistory(id: string, limit = 100) {
  return db().prepare("SELECT field, old, new, actor_kind, actor_name, at, outcome, reason FROM history WHERE row_id = ? ORDER BY id DESC LIMIT ?").all(id, limit) as {
    field: string; old: string; new: string; actor_kind: string; actor_name: string; at: string; outcome: string; reason: string | null;
  }[];
}

/** A package handed over by an agent (the portal's POST /v1/assets/packages/drafts): the same agent's draft of the same
 *  name is updated in place; a published package or a person's draft is never touched. */
export function handOverPackage(input: Record<string, unknown>, actor: Actor): WriteResult {
  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, code: "bad_request", message: "a package needs name" };
  const by = String(input.by ?? actor.name).slice(0, 80);
  const mine = allRows("packages").find((p) => String(p.name ?? "").trim().toLowerCase() === name.toLowerCase() && p.by === by && p.status !== "published" && agentDraft(p));
  const fields: Record<string, unknown> = { by };
  for (const k of ["name", "price", "offer", "buyer", "deliverables", "why", "sources"]) if (k in input) fields[k] = input[k];
  if (mine) return writeRow("packages", { id: mine.id }, fields, actor);
  return writeRow("packages", {}, fields, actor, { create: true });
}

/** An agent's review of another agent's package draft (the portal's POST /v1/assets/packages/drafts/review): stamped on
 *  the newest agent's draft of that name; a published package or a person's draft is never touched. */
export function reviewPackage(input: Record<string, unknown>, actor: Actor): { ok: true; id: string; reviewed_at: string } | { ok: false; code: "not_found" | "bad_request"; message: string } {
  const name = String(input.name ?? "").trim().toLowerCase();
  const verdict = String(input.verdict ?? "");
  if (!name || !["approve", "revise"].includes(verdict)) return { ok: false, code: "bad_request", message: "send {name, verdict: approve|revise, note?}" };
  const draft = allRows("packages").find((p) => String(p.name ?? "").trim().toLowerCase() === name && p.status !== "published" && p.last_edited_by !== null && agentDraft(p));
  if (!draft) return { ok: false, code: "not_found", message: `no agent's draft named ${String(input.name)}` };
  const at = nowIso();
  const r = writeRow("packages", { id: draft.id }, { reviewed_by: String(input.by ?? actor.name).slice(0, 80), reviewed_at: at, review_verdict: verdict, review_note: String(input.note ?? "").slice(0, 500) || null }, { kind: "bot", name: actor.name });
  return r.ok ? { ok: true, id: draft.id, reviewed_at: at } : { ok: false, code: "bad_request", message: r.ok === false ? r.message : "" };
}
/** A draft an agent handed over (its `by` cell was written by a bot). */
function agentDraft(p: Row): boolean {
  const s = db().prepare("SELECT last_by FROM rows WHERE id = ?").get(p.id) as { last_by: string } | undefined;
  return !!s && (JSON.parse(s.last_by) as Record<string, string>).by === "bot";
}

/** A Family report the Validator posts (POST /v1/family/report): kept, newest 50 of each kind. */
export function saveReport(kind: string, body: Record<string, unknown>): { id: number; at: string } {
  const d = db();
  d.exec("CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL)");
  const at = nowIso();
  const r = d.prepare("INSERT INTO reports (kind, at, body) VALUES (?, ?, ?)").run(kind, at, JSON.stringify(body));
  d.prepare("DELETE FROM reports WHERE kind = ? AND id NOT IN (SELECT id FROM reports WHERE kind = ? ORDER BY id DESC LIMIT 50)").run(kind, kind);
  return { id: Number(r.lastInsertRowid), at };
}
export function latestReports(): Record<string, { at: string; body: unknown }> {
  const d = db();
  d.exec("CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL)");
  const out: Record<string, { at: string; body: unknown }> = {};
  for (const r of d.prepare("SELECT kind, at, body FROM reports WHERE id IN (SELECT MAX(id) FROM reports GROUP BY kind)").all() as { kind: string; at: string; body: string }[])
    out[r.kind] = { at: r.at, body: JSON.parse(r.body) };
  return out;
}

/** The local Tasks board for the CEO's measure: how many are open, and when a person last moved each to Done. */
export function localTasksMeasure(closed: Set<string>): { open: number; done: string[] } {
  const tasks = allRows("tasks");
  const open = tasks.filter((t) => typeof t.status === "string" && !closed.has(t.status)).length;
  const done: string[] = [];
  const q = db().prepare("SELECT at FROM history WHERE row_id = ? AND field = 'status' AND outcome = 'applied' AND actor_kind = 'person' AND new = ? ORDER BY id DESC LIMIT 1");
  for (const t of tasks) if (t.status === "Done") {
    const h = q.get(t.id, JSON.stringify("Done")) as { at: string } | undefined;
    if (h) done.push(h.at);
  }
  return { open, done };
}

/** Leads from a CSV (lib/csv-import.ts csvRows), written as `actor`: a row matching a lead on the board (the same website
 *  domain, or with no website the same business name) only fills that lead's empty cells -- a filled cell is never
 *  overwritten -- and any other row becomes a new lead. A row without a business is skipped. */
export function importLeads(rows: Record<string, string>[], actor: Actor) {
  const out = { created: 0, filled: 0, unchanged: 0, skipped: 0, keptFilled: 0, errors: [] as string[] };
  for (const [i, r] of rows.entries()) {
    if (!r.business?.trim()) {
      out.skipped++;
      continue;
    }
    const dom = domainOf(r.website);
    const match = allRows("leads").find((l) =>
      dom ? domainOf(l.website) === dom : !l.website && String(l.business ?? "").trim().toLowerCase() === r.business.trim().toLowerCase(),
    );
    const res = match ? writeRow("leads", { id: match.id }, r, actor, { fillOnly: true }) : writeRow("leads", {}, r, actor, { create: true });
    if (!res.ok) {
      if (out.errors.length < 10) out.errors.push(`row ${i + 2}: ${res.message}`);
      continue;
    }
    if (res.created) out.created++;
    else if (res.written.length) out.filled++;
    else out.unchanged++;
    out.keptFilled += res.refused.filter((x) => x.reason === "filled").length;
  }
  return out;
}
