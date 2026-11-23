// Run: npm test (Node's own test runner; no dependency). A fixture explorer.sqlite3 built with macOS's sqlite3.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
// Node runs TypeScript directly and needs the .ts extension; the app's type check does not allow it.
// @ts-ignore TS5097
import { actionStats, agoWords, crashCount, crashEvents, lastOwnOutput, localIso, planSummary } from "../lib/family-stats.ts";

const now = new Date("2026-10-28T12:00:00").getTime();
const ago = (h: number) => localIso(now - h * 3600e3);

function fixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "family-"));
  const db = path.join(dir, "explorer.sqlite3");
  const rows: [string, string, string][] = [
    [ago(1), "lead", "allowed"],
    [ago(2), "lead", "allowed (score 80)"], // allowed% counts
    [ago(3), "open", "allowed"], // not an output type: an action, not an output
    [ago(4), "lead", "rejected: no email"],
    [ago(30), "note", "allowed"], // 7-day window only
    [ago(40), "update_lead", "rejected: filled"],
    [ago(24 * 9), "lead", "allowed"], // outside both windows
  ];
  const sql = [
    "CREATE TABLE actions (id INTEGER PRIMARY KEY, ts TEXT NOT NULL, cycle INTEGER NOT NULL DEFAULT 0, episode_id INTEGER, action_type TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '', thought TEXT, verdict TEXT NOT NULL, result TEXT, progress INTEGER NOT NULL DEFAULT 0);",
    ...rows.map(([ts, t, v]) => `INSERT INTO actions (ts, action_type, verdict) VALUES ('${ts}', '${t}', '${v.replace(/'/g, "''")}');`),
  ].join("\n");
  execFileSync("/usr/bin/sqlite3", [db, sql]);
  return db;
}

test("7-day and 24-hour windows: actions, refusals, accepted outputs by type, last action", async () => {
  const s = await actionStats(fixture(), now);
  assert.equal(s.w24.actions, 4);
  assert.equal(s.w24.refused, 1);
  assert.equal(s.w24.refusedShare, 0.25);
  assert.equal(s.w24.accepted.lead, 2);
  assert.equal(s.w24.accepted.note, 0);
  assert.equal(s.w7.actions, 6);
  assert.equal(s.w7.refused, 2);
  assert.equal(s.w7.accepted.note, 1);
  assert.equal(s.w7.accepted.update_lead, 0); // refused, so not an accepted output
  assert.equal(s.lastAction, ago(1));
});

test("an idle bot: zero counts, last action still found", async () => {
  const s = await actionStats(fixture(), now + 30 * 86400e3);
  assert.equal(s.w7.actions, 0);
  assert.equal(s.w7.refusedShare, 0);
  assert.equal(s.lastAction, ago(1));
});

test("crashes: Traceback blocks, a chained one counted once", () => {
  const log = [
    "Traceback (most recent call last):", "  x", "httpx.InvalidURL: bad port", "",
    "During handling of the above exception, another exception occurred:", "",
    "Traceback (most recent call last):", "  y", "ValueError", // the same crash, chained
    "Traceback (most recent call last):", "  z", "KeyError", // a second crash
  ].join("\n");
  assert.equal(crashCount(log), 2);
  assert.equal(crashCount("all fine\n"), 0);
});

test("plan summary: goal, steps ticked of all, active minutes", () => {
  const p = planSummary({ task: "List 5 leads", steps: [{ done: true }, { done: false }, { done: true }], active_min: 42.6, status: "active" });
  assert.deepEqual(p, { goal: "List 5 leads", done: 2, steps: 3, activeMin: 43, status: "active" });
  assert.equal(planSummary(null), null);
});




test("crash events: run_loop_crashed lines in the windows, the latest kept", () => {
  const ev = (h: number, exc: string) => JSON.stringify({ ts: ago(h), kind: "run_loop_crashed", exception: exc, message: "boom" });
  const text = [
    ev(2, "InvalidURL"),
    ev(30, "KeyError"), // 7 days only
    ev(200, "OldError"), // outside both
    JSON.stringify({ ts: ago(1), kind: "action", note: "run_loop_crashed mentioned" }), // other kind
    "not json run_loop_crashed",
  ].join("\n");
  const r = crashEvents(text, ago(168), ago(24));
  assert.equal(r.w7, 2);
  assert.equal(r.w24, 1);
  assert.equal(r.last?.exception, "InvalidURL");
});

test("last own output: the Writer's update_lead counts only with a draft; age in words", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "own-"));
  const db = path.join(dir, "explorer.sqlite3");
  const row = (ts: string, payload: object, verdict = "allowed") =>
    `INSERT INTO actions (ts, cycle, action_type, payload, verdict) VALUES ('${ts}', 0, 'update_lead', '${JSON.stringify(payload)}', '${verdict}');`;
  execFileSync("/usr/bin/sqlite3", [
    db,
    [
      "CREATE TABLE actions (id INTEGER PRIMARY KEY, ts TEXT NOT NULL, cycle INTEGER NOT NULL, episode_id INTEGER, action_type TEXT NOT NULL, payload TEXT NOT NULL, thought TEXT, verdict TEXT NOT NULL, result TEXT, progress INTEGER NOT NULL DEFAULT 0);",
      row(ago(1), { name: "A", industry: "Retail", draft_email: null }), // a cell fill, not a draft
      row(ago(2), { name: "B", draft_email: null, draft_whatsapp: "Hi" }), // WhatsApp draft
      row(ago(5), { name: "C", draft_email: "Hi" }),
      row(ago(0.5), { name: "D", draft_email: "Hi" }, "rejected: weak"),
    ].join("\n"),
  ]);
  assert.equal(await lastOwnOutput(db, "outreach-writer"), ago(2));
  assert.equal(await lastOwnOutput(db, "lead-enricher"), ago(1));
  assert.equal(await lastOwnOutput(db, "scout"), null); // no own kind
  assert.equal(agoWords(ago(3), now), "3 h ago");
  assert.equal(agoWords(ago(0.2), now), "12 min ago");
  assert.equal(agoWords(ago(52), now), "2 d 4 h ago");
});
