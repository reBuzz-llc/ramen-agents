// New finds and the owner's marks (owner, 2026-11-12): every free API the Scout records in common-data/providers-found.md
// shows on Settings > Key providers until the owner marks it usable or unusable, with a note. The marks live in
// common-data/provider-verdicts.json (seeded from the blog's /free-ai-apis page of 2026-11-06); scripts/build-blog.py
// turns them into that page at its next build. A test is the Key providers page's own (list models, a one-token answer)
// and is kept beside the marks. Pure parsing first, the files after; self-contained for the node tests.
import { mkdir, readFile, rename, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type Find = {
  name: string;
  slug: string; // the key file's name without .key
  found: string; // "2026-09-17" (the first time the Scout recorded it)
  endpoint: string;
  free: string;
  models: string[];
  why: string;
  sources: string[];
};

export type Verdict = {
  name: string;
  slug: string;
  kind: "model" | "tool";
  url: string;
  free: string;
  note: string;
  verdict: "usable" | "unusable";
  status?: "in use" | "not answering" | "verified" | "caveat";
  decided_at: string;
  by: string;
};
export type TestLine = { at: string; ok: boolean; level: string; message: string; endpoint: string; model: string };
export type VerdictFile = { _about?: string; version: 1; providers: Verdict[]; tests: Record<string, TestLine> };

export const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
const SLUG = /^[a-z0-9][a-z0-9._-]{0,60}$/;
const URL_RE = /https?:\/\/[^\s)>`"]+/g;

/** The Scout's sections: "## Name", a "Found <date>" line with the key file, "- **Endpoint:**", "- **Free terms:**",
 *  "- **Models:**", a why paragraph and "Sources:" links. A name found twice keeps its later text and its first date. */
export function parseFinds(md: string): Find[] {
  const out = new Map<string, Find>();
  const parts = md.split(/^## /m).slice(1);
  for (const part of parts) {
    const [head, ...rest] = part.split("\n");
    const name = head.trim();
    if (!name || /^\d{4}-\d{2}-\d{2}\b/.test(name)) continue; // an owner's dated note, not a provider
    const body = rest.join("\n");
    const field = (label: string) => body.match(new RegExp(`^- \\*\\*${label}:\\*\\*\\s*(.+)$`, "mi"))?.[1].trim() ?? "";
    const keyFile = body.match(/keys\/([a-z0-9._-]+)\.key/i)?.[1]?.toLowerCase();
    const found = body.match(/\bFound\b[^\n]*?(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
    const srcAt = body.search(/^Sources:/m);
    const sources = srcAt >= 0 ? [...body.slice(srcAt).matchAll(URL_RE)].map((m) => m[0].replace(/[.,;]+$/, "")) : [];
    const why = body.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("- ") && !/^Found\b|^Sources:/.test(l)).join(" ").slice(0, 400);
    const endpoint = (field("Endpoint").match(URL_RE)?.[0] ?? "").replace(/[.,;]+$/, "");
    const f: Find = {
      name, slug: keyFile && SLUG.test(keyFile) ? keyFile : name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60),
      found, endpoint, free: field("Free terms").slice(0, 400), models: field("Models").split(/,\s*/).map((m) => m.trim()).filter(Boolean).slice(0, 12), why, sources: [...new Set(sources)].slice(0, 6),
    };
    const k = norm(name);
    const before = out.get(k);
    out.set(k, before ? { ...f, found: before.found && (!f.found || before.found < f.found) ? before.found : f.found } : f);
  }
  return [...out.values()];
}

/** The owner's mark for a find, matched by key name or by name. */
export function verdictFor(f: { name: string; slug: string }, list: Verdict[]): Verdict | null {
  const keys = new Set([norm(f.name), norm(f.slug)]);
  return list.find((v) => keys.has(norm(v.slug)) || keys.has(norm(v.name))) ?? null;
}

export type FindRow = Find & { hasKey: boolean; test: TestLine | null };
/** Finds without a mark, newest first: what waits for the owner. */
export function newFinds(finds: Find[], file: VerdictFile, keys: Set<string>): FindRow[] {
  return finds
    .filter((f) => !verdictFor(f, file.providers))
    .map((f) => ({ ...f, hasKey: keys.has(f.slug), test: file.tests[f.slug] ?? null }))
    .sort((a, b) => (b.found || "").localeCompare(a.found || "") || a.name.localeCompare(b.name));
}

export type Mark = { name: string; slug: string; verdict: "usable" | "unusable"; note: string; kind?: "model" | "tool"; url?: string; free?: string };
/** The marks with one more (or one changed): a name or key already marked is replaced in place. */
export function withMark(file: VerdictFile, m: Mark, now = new Date()): VerdictFile | string {
  if (!SLUG.test(m.slug)) return "that key name is not one the keys folder takes";
  if (m.verdict !== "usable" && m.verdict !== "unusable") return "mark it usable or unusable";
  const note = m.note.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!note) return "say why in a short note: it goes on the blog page";
  if (m.url && !/^https:\/\/[^\s]+$/.test(m.url)) return "the link starts with https://";
  const old = verdictFor(m, file.providers);
  const v: Verdict = {
    name: m.name.replace(/\s+/g, " ").trim().slice(0, 80) || old?.name || m.slug, slug: m.slug,
    kind: m.kind ?? old?.kind ?? "model", url: m.url ?? old?.url ?? "", free: (m.free ?? old?.free ?? "").slice(0, 400), note, verdict: m.verdict,
    // the owner's own test makes a usable find "verified"; "in use" and the rest stay what the fleet knows
    ...(m.verdict === "usable" ? { status: old?.verdict === "usable" && old.status ? old.status : "verified" } : {}),
    decided_at: now.toISOString().slice(0, 19), by: "Owner",
  };
  const providers = old ? file.providers.map((p) => (p === old ? v : p)) : [...file.providers, v];
  return { ...file, providers };
}

// ---- the files ---------------------------------------------------------------------------------------------------------
const LOCK_STALE_MS = 30_000;
export const EMPTY: VerdictFile = { version: 1, providers: [], tests: {} };

export async function readVerdicts(file: string): Promise<VerdictFile> {
  try {
    const j = JSON.parse(await readFile(/*turbopackIgnore: true*/ file, "utf8")) as Partial<VerdictFile>;
    return { ...j, version: 1, providers: Array.isArray(j.providers) ? j.providers : [], tests: j.tests && typeof j.tests === "object" ? j.tests : {} };
  } catch {
    return { ...EMPTY };
  }
}

/** Read, change and write the marks under the mkdir lock (`<file>.lock`, 30 s stale), tmp + rename. */
export async function changeVerdicts(file: string, fn: (f: VerdictFile) => VerdictFile | string): Promise<VerdictFile | string> {
  const lock = `${file}.lock`;
  await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  for (let i = 0; ; i++) {
    try {
      await mkdir(/*turbopackIgnore: true*/ lock);
      break;
    } catch {
      const age = await stat(/*turbopackIgnore: true*/ lock).then((s) => Date.now() - s.mtimeMs, () => 0);
      if (age > LOCK_STALE_MS) await rmdir(/*turbopackIgnore: true*/ lock).catch(() => {});
      else if (i > 100) return "the marks file is busy; try again in a moment";
      else await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    const next = fn(await readVerdicts(file));
    if (typeof next === "string") return next;
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(/*turbopackIgnore: true*/ tmp, `${JSON.stringify(next, null, 1)}\n`, "utf8");
    await rename(/*turbopackIgnore: true*/ tmp, file);
    return next;
  } finally {
    await rmdir(/*turbopackIgnore: true*/ lock).catch(() => {});
  }
}
