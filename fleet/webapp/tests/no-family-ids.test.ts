// The public starter carries nothing of the family's own (a link to one of the family's
// Notion pages shipped in work-plan-view.tsx): every tracked file of this repository is scanned for a Notion link or page
// id, a 32-hex id that is not an obvious placeholder, a Supabase project ref, a tailnet name and a timestamp with a local
// UTC offset. The family's own names are checked from the maintainers' private list (RAMEN_PRIVATE_WORDS), never written here. A placeholder reads as one: "<project-ref>", "<mac>.<tailnet>.ts.net", a run of one
// character, or an id starting 0123 / 1234 / abcd / dead.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF = "webapp/tests/no-family-ids.test.ts";
const PATTERNS: [string, RegExp][] = [
  ["a Notion link", /\b(?:www\.)?notion\.(?:so|site)\/|app\.notion\.com\//i],
  ["a Supabase project ref", /\b(?!<)[a-z]{20}\.supabase\.(?:co|com)\b/],
  ["a tailnet name", /\btail[0-9a-f]{6}\.ts\.net\b/i],
  // a date-time with a UTC offset other than Z / +00:00 dates a file to a place
  ["a timestamp with a local offset", /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?[+-](?!00:?00\b)\d{2}:?\d{2}\b/],
];
const HEX = /\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b/gi;
const placeholder = (v: string) => {
  const h = v.replace(/-/g, "").toLowerCase();
  return new Set(h).size <= 4 || /(.)\1{5}/.test(h) || /^(0123|1234|abcd|dead|0000)/.test(h);
};

test("no id, link or name of the family's own in any tracked file", () => {
  const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const found: string[] = [];
  for (const f of files) {
    if (f === SELF || /(^|\/)package-lock\.json$|\.(png|jpe?g|gif|ico|pdf|woff2?|ttf|sqlite3?)$/.test(f) || /drizzle\/meta\//.test(f)) continue;
    let text = "";
    try {
      text = readFileSync(path.join(ROOT, f), "utf8");
    } catch {
      continue;
    }
    text.split("\n").forEach((line, i) => {
      for (const [what, re] of PATTERNS) if (re.test(line)) found.push(`${f}:${i + 1}: ${what}`);
      for (const m of line.matchAll(HEX)) if (!placeholder(m[0])) found.push(`${f}:${i + 1}: an id ${m[0].slice(0, 8)}…`);
    });
  }
  assert.deepEqual(found, []);
});

// The docs may not credit a member the starter does not ship. The family's own members are never
// named in the prose; a member you can add (Lead Enricher, Outreach Writer) is named only in a paragraph or table row
// that says so. Prompts and rule files (validator/instructions/, */persona.md) are rules for the member, not claims.
const ADDABLE = /\b(?:Lead\s+)?Enricher\b|\bOutreach\s+Writer\b/i;
const SAYS_ADDABLE = /if you add one|does not ship|ships no\b|not part of this starter/i;

test("the docs credit no member the starter does not ship", () => {
  const files = execFileSync("git", ["ls-files", "*.md", "*.txt"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const found: string[] = [];
  for (const f of files) {
    if (f.startsWith("validator/instructions/") || /(^|\/)persona\.md$/.test(f)) continue;
    const text = readFileSync(path.join(ROOT, f), "utf8");
    // a unit is a paragraph (a run of non-blank lines) or one table row; headings are skipped
    const units: [number, string][] = [];
    let para: [number, string[]] | null = null;
    text.split("\n").forEach((line, i) => {
      const row = /^\s*\|/.test(line), head = /^\s*#/.test(line);
      if (!line.trim() || row || head) {
        if (para) units.push([para[0], para[1].join(" ")]);
        para = null;
        if (row) units.push([i + 1, line]);
        return;
      }
      if (!para) para = [i + 1, []];
      para[1].push(line);
    });
    if (para) units.push([(para as [number, string[]])[0], (para as [number, string[]])[1].join(" ")]);
    for (const [at, block] of units) if (ADDABLE.test(block) && !SAYS_ADDABLE.test(block)) found.push(`${f}:${at}: names a member the starter does not ship`);
  }
  assert.deepEqual(found, []);
});

// The maintainers' own names (a machine, products, repos, members the starter never shipped) stay in their private list.
// Without that list this one check is skipped and says so; a name itself is never printed.
const NAMES_HEADER = "# own names the public tests refuse";
const LIST = process.env.RAMEN_PRIVATE_WORDS ?? "";
const HAS_LIST = Boolean(LIST) && existsSync(LIST);

function ownNames(): string[] {
  const lines = readFileSync(LIST, "utf8").split("\n");
  const at = lines.findIndex((l) => l.startsWith(NAMES_HEADER));
  assert.ok(at >= 0, `the private list has no section starting "${NAMES_HEADER}"`);
  const names: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith("#")) break;
    if (line.trim()) names.push(line.trim());
  }
  assert.ok(names.length > 0, "the private list's names section is empty");
  return names;
}

test("no tracked file or path holds a private name", { skip: HAS_LIST ? false : "RAMEN_PRIVATE_WORDS is not set: this check needs the maintainers' list" }, () => {
  const rx = new RegExp(`(?<![A-Za-z0-9])(?:${ownNames().map((n) => n.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")).join("|")})(?![A-Za-z0-9])`, "i");
  const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const found: string[] = [];
  for (const f of files) {
    if (rx.test(f)) found.push(`${f}: its path`);
    if (/(^|\/)package-lock\.json$|\.(png|jpe?g|gif|ico|pdf|woff2?|ttf|sqlite3?)$/.test(f)) continue;
    let text = "";
    try {
      text = readFileSync(path.join(ROOT, f), "utf8");
    } catch {
      continue;
    }
    text.split("\n").forEach((line, i) => {
      if (rx.test(line)) found.push(`${f}:${i + 1}: a private name`);
    });
  }
  assert.deepEqual(found, []);
});
