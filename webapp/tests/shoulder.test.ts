// Run: npm test. Over the shoulder (2026-10-31): the screenshot only while fresh, the page from the
// newest trace, the last 20 actions with their verdicts, on fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
// @ts-ignore TS5097
import { feedRows, freshShot, localIso, shoulder, tracePage } from "../lib/board.ts";

const PROMPT = [
  "## Your state",
  "Episode 12",
  "",
  "## Current page",
  "URL: https://www.chamber.example/meet-our-members",
  "Title: Meet Our Members",
  "Already noted: no.",
  "Text:",
  "100 Main Street, Springfield",
  "",
  "",
  "",
  "Phone: 555-010-0100",
  "",
  "## Your move",
  "Reply with JSON.",
].join("\n");

test("trace page: URL, domain, title and the text the bot read; none without a page", () => {
  assert.deepEqual(tracePage(PROMPT), {
    url: "https://www.chamber.example/meet-our-members",
    domain: "chamber.example",
    title: "Meet Our Members",
    text: "100 Main Street, Springfield\n\nPhone: 555-010-0100",
  });
  assert.equal(tracePage("## Your state\n## Current page\nURL: (none)\n## Your move"), null);
  assert.equal(tracePage("no page at all"), null);
});

test("feed rows: words, the verdict as one word, the reason for a refusal", () => {
  const rows = feedRows([
    { ts: "2026-10-31T09:02:00", action_type: "lead", payload: '{"name":"Bloom"}', verdict: "allowed", thought: "a florist" },
    { ts: "2026-10-31T09:01:00", action_type: "open", payload: '{"url":"https://a.com"}', verdict: "rejected: you already opened this today", thought: "" },
    { ts: "2026-10-31T09:00:00", action_type: "search", payload: '{"query":"nyc"}', verdict: "failed: timeout", thought: null },
  ]);
  assert.deepEqual(
    rows.map((r: { words: string; verdict: string; reason: string }) => [r.words, r.verdict, r.reason]),
    [
      ["listed lead 'Bloom'", "allowed", ""],
      ["opened a.com", "refused", "you already opened this today"],
      ["searched 'nyc'", "failed", "timeout"],
    ],
  );
});

test("screenshot: shown when under 10 minutes old, not when older or missing; page and feed from fixtures", async () => {
  const now = Date.now();
  const ws = await mkdtemp(path.join(tmpdir(), "shoulder-"));
  await mkdir(path.join(ws, "screenshots"), { recursive: true });
  const shot = path.join(ws, "screenshots", "current.png");
  assert.equal(await freshShot(ws, now), null);
  await writeFile(shot, Buffer.from([137, 80, 78, 71]));
  await utimes(shot, new Date(now - 3 * 60e3), new Date(now - 3 * 60e3));
  assert.ok(await freshShot(ws, now));
  await utimes(shot, new Date(now - 11 * 60e3), new Date(now - 11 * 60e3));
  assert.equal(await freshShot(ws, now), null);

  const day = path.join(ws, "traces", localIso(now).slice(0, 10));
  await mkdir(day, { recursive: true });
  await writeFile(path.join(day, "090000-1-search.json"), JSON.stringify({ prompt: "## Current page\nURL: https://old.example\nTitle: Old\nText:\nold" }));
  await writeFile(path.join(day, "090500-2-open.json"), JSON.stringify({ prompt: PROMPT }));
  const db = path.join(ws, "explorer.sqlite3");
  const inserts = Array.from({ length: 25 }, (_, i) => `INSERT INTO actions(ts, cycle, action_type, payload, thought, verdict) VALUES ('2026-10-31T09:${String(i).padStart(2, "0")}:00', 1, 'open', '{"url":"https://s${i}.com"}', 'step ${i}', '${i % 5 ? "allowed" : "rejected: blocked for today"}');`);
  execFileSync("/usr/bin/sqlite3", [db], {
    input: ["CREATE TABLE actions (id INTEGER PRIMARY KEY, ts TEXT, cycle INTEGER, episode_id INTEGER, action_type TEXT, payload TEXT, thought TEXT, verdict TEXT, result TEXT, progress INTEGER DEFAULT 0);", ...inserts].join("\n"),
  });
  const s = await shoulder(ws, db, now);
  assert.equal(s.shot, null);
  assert.equal(s.page?.domain, "chamber.example");
  assert.equal(s.feed.length, 20);
  assert.equal(s.feed[0].words, "opened s24.com");
  assert.equal(s.feed.find((f: { verdict: string }) => f.verdict === "refused")?.reason, "blocked for today");
  assert.equal(s.thought, "step 24");
});
