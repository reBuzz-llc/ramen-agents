// Settings -> Personas (owner via creatorCC, queue 489: "where do I see the persona?"): a member's persona.md by section,
// each heading marked as the owner's or as one the CEO may edit (common-data/persona-sections.toml, an allow list; the
// CEO's own persona and the Validator's are all the owner's). The owner edits an owner section here: the section is
// written under persona.md.lock (tmp + rename, lib/ceo-changes.ts writeSection) and the Validator's record of the
// owner's sections (shared-state/persona-owner-sections.json, {slug: {heading: {sha1, text}}}, sha1 of the trimmed body,
// 16 hex) is updated under its mkdir lock, so validator/persona_owner.py does not report the owner's own edit as
// "changed outside a CEO change". A character section is the CEO's and is refused here. The engine reloads a persona on
// its mtime: no restart.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/** (heading, body start, body end) per "## " section, up to the next "## " or "# " line (### stays inside): the engine's
 *  roster.sections and lib/ceo-changes.ts personaSections, repeated here so this file stays self-contained for its test. */
export function personaSections(text: string): [string, number, number][] {
  const heads: [string, string, number, number][] = [];
  let pos = 0;
  for (const ln of text.split(/(?<=\n)/)) {
    const m = /^(#{1,2}) (.+?)\s*$/.exec(ln.replace(/\n$/, ""));
    if (m) heads.push([m[1], m[2], pos, pos + ln.length]);
    pos += ln.length;
  }
  return heads.flatMap(([level, name, , body], i) => (level === "##" ? [[name, body, i + 1 < heads.length ? heads[i + 1][2] : text.length] as [string, number, number]] : []));
}
/** lib/ceo-changes.ts writeSection: the section written under persona.md.lock while it still reads as `expect`. */
export type WriteSection = (file: string, heading: string, expect: string | null, put: string) => Promise<string>;

export const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;
const NEVER_CEO = new Set(["the-ceo", "validator"]);

/** The headings the CEO may edit for a member, from persona-sections.toml ([slug] character = [...]). */
export function characterOf(toml: string, slug: string): string[] {
  if (NEVER_CEO.has(slug)) return [];
  const table = toml.split(/^\[/m).find((t) => t.startsWith(`${slug}]`));
  if (!table) return [];
  const m = table.match(/^\s*character\s*=\s*\[([\s\S]*?)\]/m);
  return m ? [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1].replace(/\\(["\\])/g, "$1")) : [];
}

const base = (h: string) => h.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
/** A heading on the allow list, with or without its "(owner, ...)" tail, as the Validator matches it. */
export function isCharacter(heading: string, character: string[]): boolean {
  const allow = new Set(character.map((c) => c.toLowerCase()));
  return allow.has(heading.toLowerCase()) || allow.has(base(heading));
}

export type PersonaSection = { heading: string; body: string; owner: boolean };
export type PersonaView = { preamble: string; sections: PersonaSection[] };

export function personaView(text: string, character: string[]): PersonaView {
  const secs = personaSections(text);
  const firstHead = secs.length ? text.lastIndexOf("\n## ", secs[0][1]) : -1;
  const preamble = (secs.length ? text.slice(0, firstHead >= 0 ? firstHead : 0) : text).trim();
  return { preamble, sections: secs.map(([heading, a, b]) => ({ heading, body: text.slice(a, b), owner: !isCharacter(heading, character) })) };
}

/** The Validator's hash of a section body. */
export const sha16 = (body: string) => createHash("sha1").update(body.trim(), "utf8").digest("hex").slice(0, 16);

/** The new body in the old one's frame: its leading and trailing whitespace kept; or why the text cannot go in. */
export function frameBody(old: string, raw: string): string | { error: string } {
  const t = raw.replace(/\r\n/g, "\n").trim();
  if (!t) return { error: "the section would be empty: write something, or leave it as it is" };
  if (t.length > 4000) return { error: "at most 4,000 characters in one section" };
  if (/^#{1,2} /m.test(t)) return { error: "a line starting with # or ## would split the persona into another section: use ### for a sub-heading" };
  return `${old.match(/^\s*/)?.[0] ?? "\n"}${t}${old.match(/\s*$/)?.[0] ?? "\n"}`;
}

const LOCK_STALE_MS = 30_000;
async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  for (let i = 0; ; i++) {
    try {
      await mkdir(/*turbopackIgnore: true*/ lock);
      break;
    } catch {
      const age = await stat(/*turbopackIgnore: true*/ lock).then((s) => Date.now() - s.mtimeMs, () => 0);
      if (age > LOCK_STALE_MS) await rmdir(/*turbopackIgnore: true*/ lock).catch(() => {});
      else if (i > 100) throw new Error("the Validator's persona record is busy; try again in a moment");
      else await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    await rmdir(/*turbopackIgnore: true*/ lock).catch(() => {});
  }
}

export type Paths = { bots: string; store: string; sections: string };

/** The owner's edit of one owner section: "" when written, else why not. `before` is the body the owner saw (a change
 *  made meanwhile is not overwritten). */
export async function ownerEdit(p: Paths, slug: string, heading: string, before: string, text: string, writeSection: WriteSection): Promise<string> {
  if (!SLUG.test(slug)) return "no such member";
  const file = path.join(p.bots, slug, "persona.md");
  const [cur, toml] = await Promise.all([readFile(/*turbopackIgnore: true*/ file, "utf8").catch(() => null), readFile(/*turbopackIgnore: true*/ p.sections, "utf8").catch(() => "")]);
  if (cur === null) return "this member has no persona.md";
  if (isCharacter(heading, characterOf(toml, slug))) return "this is a character section: the CEO edits it (Undo its change instead)";
  const sec = personaSections(cur).find(([h]) => h === heading);
  if (!sec) return "that section is not in the persona any more: reload the page";
  const put = frameBody(cur.slice(sec[1], sec[2]), text);
  if (typeof put !== "string") return put.error;
  const err = await writeSection(file, heading, before, put);
  if (err) return err === "changed" || /changed/.test(err) ? "the section changed since you opened it: reload the page" : err;
  await withLock(p.store, async () => {
    let seen: Record<string, Record<string, { sha1: string; text: string }>> = {};
    try {
      seen = JSON.parse(await readFile(/*turbopackIgnore: true*/ p.store, "utf8"));
    } catch {
      /* first record */
    }
    seen[slug] = { ...(seen[slug] ?? {}), [heading]: { sha1: sha16(put), text: put } };
    const tmp = `${p.store}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(seen, null, 1), "utf8");
    await rename(/*turbopackIgnore: true*/ tmp, p.store);
  });
  return "";
}
