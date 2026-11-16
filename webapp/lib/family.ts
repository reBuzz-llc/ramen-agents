// Server-side only: the family's own answers, common-data/local/family.toml (queue 572). The file is git-ignored, so
// `git pull` and sh scripts/update.sh never meet it. sh scripts/setup.sh writes it (scripts/family_answers.py), and so
// does the dashboard's first-run page (/setup); the engine and the Validator read it on top of the tracked files:
// [company] fills {company} {sells} {buyers} {place} {owner} {signoff} in the cards, [target] sits on top of
// common-data/knowledge/target.toml, [[team]] replaces common-data/team.json, own_domains joins the own-domain lists.
//
// The file is small and has one shape, so this reads and writes only that shape: a top-level `steer`, the tables
// [company] and [target], and [[team]] rows, with strings, booleans, numbers and arrays of strings as values.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const BOTS_DIR = process.env.BOTS_DIR ?? path.join(homedir(), "bots"); // as lib/bots.ts (no import: Node's test runner loads this file)
export const familyFile = () => process.env.FAMILY_FILE ?? path.join(BOTS_DIR, "common-data", "local", "family.toml");

type Value = string | number | boolean | string[];
export type Table = Record<string, Value>;
export type Family = { steer?: string; company: Table; target: Table; team: Table[]; other: Record<string, Table> };

const VALUE = /^("(?:[^"\\]|\\.)*"|\[(?:\s*"(?:[^"\\]|\\.)*"\s*,?)*\s*\]|true|false|-?\d+(?:\.\d+)?)\s*(?:#.*)?$/;

/** Parse family.toml's shape. A line it does not understand is skipped, never guessed. */
export function parseFamily(text: string): Family {
  const out: Family = { company: {}, target: {}, team: [], other: {} };
  let cur: Table | null = null; // null: the top level
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let m = /^\[\[\s*([A-Za-z0-9_-]+)\s*\]\]\s*(?:#.*)?$/.exec(line);
    if (m) {
      cur = {};
      if (m[1] === "team") out.team.push(cur);
      continue;
    }
    m = /^\[\s*([A-Za-z0-9_-]+)\s*\]\s*(?:#.*)?$/.exec(line);
    if (m) {
      cur = m[1] === "company" ? out.company : m[1] === "target" ? out.target : (out.other[m[1]] ??= {});
      continue;
    }
    m = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!m) continue;
    const v = VALUE.exec(m[2].trim());
    if (!v) continue;
    let val: Value;
    try {
      val = JSON.parse(v[1]) as Value;
    } catch {
      continue;
    }
    if (cur) cur[m[1]] = val;
    else if (m[1] === "steer" && typeof val === "string") out.steer = val;
  }
  return out;
}

const q = (v: Value): string => (Array.isArray(v) ? `[${v.map((x) => JSON.stringify(String(x))).join(", ")}]` : typeof v === "string" ? JSON.stringify(v) : String(v));
const table = (t: Table) => Object.entries(t).map(([k, v]) => `${k} = ${q(v)}`);

export function renderFamily(f: Family): string {
  const lines = ["# Your family's answers (sh scripts/setup.sh, or the dashboard's first-run page). Not in git: yours to keep and edit."];
  // a top-level key comes before the first table, or TOML puts it inside that table
  if (f.steer?.trim()) lines.push(`steer = ${q(f.steer.trim())}`);
  lines.push("", "[company]", ...table(f.company), "", "[target]", ...table(f.target));
  for (const [name, t] of Object.entries(f.other)) lines.push("", `[${name}]`, ...table(t));
  for (const row of f.team) lines.push("", "[[team]]", ...table(row));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

export async function readFamily(): Promise<Family | null> {
  try {
    return parseFamily(await readFile(/*turbopackIgnore: true*/ familyFile(), "utf8"));
  } catch {
    return null;
  }
}

export async function saveFamily(f: Family): Promise<void> {
  const file = familyFile();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmp, renderFamily(f), { mode: 0o600 });
  await rename(tmp, file);
}

const str = (t: Table | undefined, k: string) => (typeof t?.[k] === "string" ? (t[k] as string).trim() : "");

/** What the family still needs before the agents know who they work for (what setup-check calls ready). */
export function familyMissing(f: Family | null): string[] {
  const miss = [["name", "your company's name"], ["sells", "what you sell"], ["buyers", "who buys it"]].filter(([k]) => !str(f?.company, k)).map(([, w]) => w);
  if (!str(f?.target, "market")) miss.push("where your customers are");
  return miss;
}

/** The answers the first-run page asks, flat. */
export type Answers = { name: string; sells: string; buyers: string; place: string; segment: string; trades: string; owner: string; signoff: string; domains: string; teammate: string; steer: string };

export function answersOf(f: Family | null): Answers {
  const c = f?.company, t = f?.target;
  return {
    name: str(c, "name"),
    sells: str(c, "sells"),
    buyers: str(c, "buyers"),
    place: str(c, "place") || str(t, "market"),
    segment: str(t, "segment") || "small businesses",
    trades: str(t, "trades"),
    owner: str(c, "owner"),
    signoff: typeof c?.signoff === "string" ? c.signoff : "",
    domains: Array.isArray(c?.own_domains) ? c.own_domains.join(", ") : "",
    teammate: str(f?.team[0], "name"),
    steer: f?.steer ?? "",
  };
}

const MAX = 300;
const one = (v: unknown, max = MAX) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function domainList(raw: string): string[] {
  const out: string[] = [];
  for (const x of raw.split(",")) {
    const d = x.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    if (d && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) && !out.includes(d)) out.push(d);
  }
  return out;
}

/** Fold the page's answers into the file, the way scripts/family_answers.py writes them; keys the page does not ask
 * (more [[team]] rows, a hand-set market_short or areas, other tables) are kept. Throws on a missing answer. */
export function applyAnswers(f: Family | null, raw: unknown): Family {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const a = {
    name: one(r.name, 120),
    sells: one(r.sells),
    buyers: one(r.buyers),
    place: one(r.place, 120),
    segment: one(r.segment, 80) || "small businesses",
    trades: one(r.trades),
    owner: one(r.owner, 80),
    domains: one(r.domains),
    teammate: one(r.teammate, 80),
    steer: one(r.steer, 600),
    signoff: typeof r.signoff === "string" ? r.signoff.replace(/\r/g, "").trim().slice(0, 300) : "",
  };
  const miss = [["name", "your company's name"], ["sells", "what you sell"], ["buyers", "who buys it"], ["place", "where your customers are"]].filter(([k]) => !a[k as keyof typeof a]).map(([, w]) => w);
  if (miss.length) throw new Error(`needed: ${miss.join(", ")}`);
  const next: Family = f ? { ...f, company: { ...f.company }, target: { ...f.target }, team: f.team.map((t) => ({ ...t })), other: { ...f.other } } : { company: {}, target: {}, team: [], other: {} };
  const owner = a.owner || a.name;
  // a sign-off still at the old answers' default follows the new name, not the old one
  const was = answersOf(f);
  if (a.signoff === `Regards,\n${was.owner || was.name}\n-- ${was.name}`) a.signoff = "";
  const placeChanged = str(next.target, "market") !== a.place;
  Object.assign(next.company, {
    name: a.name,
    sells: a.sells,
    buyers: a.buyers,
    place: a.place,
    owner,
    signoff: a.signoff || `Regards,\n${owner}\n-- ${a.name}`,
    own_domains: domainList(a.domains),
  });
  Object.assign(next.target, { market: a.place, segment: a.segment, trades: a.trades || a.buyers });
  if (placeChanged || !str(next.target, "market_short")) next.target.market_short = a.place.split(",")[0].trim();
  const mate = a.teammate || owner;
  if (next.team.length) next.team[0].name = mate;
  else next.team.push({ name: mate, role: "sends the first emails and answers replies", details: "Tasks about sending, replies and meetings go to this person." });
  next.steer = a.steer || undefined;
  return next;
}

/** The people on the team: family.toml's [[team]] (and the owner) when it has rows, else common-data/team.json, as the
 * engine reads them. Starter placeholders are left out. */
export async function teamPeople(): Promise<string[]> {
  const f = await readFamily();
  const fromFamily = [...(f?.team ?? []).map((t) => str(t, "name")), str(f?.company, "owner")];
  let names = f?.team.length ? fromFamily : [];
  if (!names.length) {
    try {
      const doc = JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(BOTS_DIR, "common-data", "team.json"), "utf8")) as { members?: { name?: string }[] };
      names = [...(doc.members ?? []).map((m) => String(m.name ?? "").trim()), str(f?.company, "owner")];
    } catch {
      names = fromFamily;
    }
  }
  return [...new Set(names.filter((n) => n && !n.startsWith("FILL-ME")))];
}
