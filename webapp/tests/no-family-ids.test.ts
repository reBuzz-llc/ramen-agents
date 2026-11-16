// The public starter carries nothing of the family's own (queue 572; creatorCC 11-16: a link to one of the family's
// Notion pages shipped in work-plan-view.tsx): every tracked file of this repository is scanned for a Notion link or page
// id, a 32-hex id that is not an obvious placeholder, a Supabase project ref, a tailnet or device name, and the family's
// own addresses and repo names. A placeholder reads as one: "<project-ref>", "<mac>.<tailnet>.ts.net", a run of one
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
const OWN = [["rebuzzs", "mac"].join("-"), ["productive", "peek"].join("-"), ["rebot", "omega"].join("-"), ["peek", "q5"].join("-"), ["bot", "q378"].join("-")];
const PATTERNS: [string, RegExp][] = [
  ["a Notion link", /\b(?:www\.)?notion\.(?:so|site)\/|app\.notion\.com\//i],
  ["a Supabase project ref", /\b(?!<)[a-z]{20}\.supabase\.(?:co|com)\b/],
  ["a tailnet name", /\btail[0-9a-f]{6}\.ts\.net\b/i],
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
