// Run: npm test. The Reports page under Settings reads two files: the Validator's refusal report (markdown) and this
// week's OKR (okr-week.md); both parsed from fixtures here (2026-10-30).
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore TS5097
import { parseReport } from "../lib/report-md.ts";
// @ts-ignore TS5097
import { parseOkr } from "../lib/family-stats.ts";

const REPORT = [
  "# Refusal report, 24 h to 2026-10-30 16:24 (Validator)",
  "",
  "## Before and after (baseline: 24 h to 2026-10-29T23:19)",
  "",
  "| Bot | Refused before | Refused now |",
  "|---|---|---|",
  "| lead-gen | 31% | 23% |",
  "| the-ceo | 56% | 75% |",
  "",
  "Moved (refused share down 10 points or more): outreach-writer 41% → 21%.",
  "",
  "## lead-gen",
  "- 12 × you already searched '…'",
  "  - nested detail",
].join("\n");

test("refusal report: headings, the table, paragraphs and bullets, in order", () => {
  const b = parseReport(REPORT);
  assert.deepEqual(
    b.map((x: { kind: string }) => x.kind),
    ["h1", "h2", "table", "p", "h2", "li", "li"],
  );
  const table = b[2] as { head: string[]; rows: string[][] };
  assert.deepEqual(table.head, ["Bot", "Refused before", "Refused now"]);
  assert.deepEqual(table.rows, [
    ["lead-gen", "31%", "23%"],
    ["the-ceo", "56%", "75%"],
  ]);
  assert.equal((b[5] as { text: string }).text, "12 × you already searched '…'");
  assert.deepEqual(parseReport(""), []);
});

test("okr-week.md: the objective and each key result with its progress line", () => {
  const md = [
    "# This week's objective (2026-10-27 to 2026-11-02) -- PROPOSED, the owner edits",
    "",
    "Objective: the first replies from New York small businesses.",
    "",
    "Key results (what counts, measured on the Leads board):",
    "1. The team sends 30 drafted emails by hand, best Lead score first.",
    "   Progress (2026-10-30 16:24): 0 rows marked Email Sent this week -- target 30.",
    "2. 3 rows reach Result = Replied, Meeting or Client.",
    "3. Every sent row has its Contact role filled and a Lead score.",
  ].join("\n");
  const o = parseOkr(md);
  assert.ok(o, "parsed");
  assert.equal(o.krs.length, 3);
  assert.equal(o.week, "10-27 to 11-02");
  assert.match(o.objective, /first replies/);
  assert.equal(o.krs[0].progress, "0 rows marked Email Sent this week -- target 30.");
});
