// The public starter carries nothing of the family's own (a link to one of the family's
// Notion pages shipped in work-plan-view.tsx): every tracked file of this repository is scanned for a Notion link or page
// id, a 32-hex id that is not an obvious placeholder, a Supabase project ref, a tailnet or device name, and the family's
// own addresses and repo names, and a timestamp with a local UTC offset. A placeholder reads as one: "<project-ref>", "<mac>.<tailnet>.ts.net", a run of one
// character, or an id starting 0123 / 1234 / abcd / dead.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF = "webapp/tests/no-family-ids.test.ts";
// the family's own names, built from parts so this file is no list of them
const OWN = [["rebuzzs", "mac"].join("-"), ["productive", "peek"].join("-"), ["rebot", "omega"].join("-"), ["peek", "q5"].join("-"), ["bot", "q378"].join("-"), ["com", "rebuzz", ""].join("."), ["mac", "Bot1"].join("")];
const PATTERNS: [string, RegExp][] = [
  ["a Notion link", /\b(?:www\.)?notion\.(?:so|site)\/|app\.notion\.com\//i],
  ["a Supabase project ref", /\b(?!<)[a-z]{20}\.supabase\.(?:co|com)\b/],
  ["a tailnet name", /\btail[0-9a-f]{6}\.ts\.net\b/i],
  // a date-time with a UTC offset other than Z / +00:00 dates a file to a place
  ["a timestamp with a local offset", /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?[+-](?!00:?00\b)\d{2}:?\d{2}\b/],
  ["the family's own name", new RegExp(OWN.map((s) => s.replace(/[-.]/g, "\\$&")).join("|"), "i")],
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
const FAMILY_ONLY = new RegExp([["Jobless", "Bot"].join("-"), ["Onion", "Reader"].join(" "), ["Desk", "Agent"].join(" ")].join("|"), "i");
const ADDABLE = /\b(?:Lead\s+)?Enricher\b|\bOutreach\s+Writer\b/i;
const SAYS_ADDABLE = /if you add one|does not ship|ships no\b|not part of this starter/i;

test("the docs credit no member the starter does not ship", () => {
  const files = execFileSync("git", ["ls-files", "*.md", "*.txt"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const found: string[] = [];
  for (const f of files) {
    if (f.startsWith("validator/instructions/") || /(^|\/)persona\.md$/.test(f)) continue;
    const text = readFileSync(path.join(ROOT, f), "utf8");
    text.split("\n").forEach((line, i) => {
      if (FAMILY_ONLY.test(line)) found.push(`${f}:${i + 1}: a member only the family has`);
    });
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

// With their code gone, the three members only the family had are named in no
// tracked file at all, by name or by slug (code, tests, fixtures, configs and docs alike).
const FAMILY_SLUGS = new RegExp(["jobless", "onion-reader", "desk-agent"].map((s, i) => (i ? s : `${s}-bot`)).join("|"), "i");

test("no tracked file names a member only the family had", () => {
  const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const found: string[] = [];
  for (const f of files) {
    if (f === SELF || /(^|\/)package-lock\.json$|\.(png|jpe?g|gif|ico|pdf|woff2?|ttf|sqlite3?)$/.test(f)) continue;
    if (FAMILY_ONLY.test(f) || FAMILY_SLUGS.test(f)) found.push(`${f}: its path`);
    let text = "";
    try {
      text = readFileSync(path.join(ROOT, f), "utf8");
    } catch {
      continue;
    }
    text.split("\n").forEach((line, i) => {
      if (FAMILY_ONLY.test(line) || FAMILY_SLUGS.test(line)) found.push(`${f}:${i + 1}: a member only the family had`);
    });
  }
  assert.deepEqual(found, []);
});
