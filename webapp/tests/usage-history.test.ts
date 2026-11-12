// Run: npm test. Key providers > Reports (owner, 2026-11-05): the daily usage history and the period reports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-ignore TS5097
import { mergeDay, periodRange, readHistory, recordUsage, snapshot, usageReport, type UsageHistory } from "../lib/usage-history.ts";

const CALLS = {
  day: "2026-11-05",
  counts: { "api.z.ai": 900, gemini: 10 },
  usage: { "api.z.ai": { decide: [500, 1000, 200], write: [300, 400, 100] }, "api.groq.com": { decide: [5, 50, 10] } },
  by_bot: { "Lead Gen": 1200, "The CEO": 560 },
};

test("a day's snapshot: calls per host (the larger of the count and the kinds), prompt and reply tokens, bots, searches", () => {
  const s = snapshot(CALLS, { tavily: { "2026-11-05": 4, "2026-11-04": 9 }, parallel: {} });
  assert.equal(s?.day, "2026-11-05");
  assert.deepEqual(s?.usage.hosts, {
    "api.z.ai": { calls: 900, tokens: 1700 },
    gemini: { calls: 10, tokens: 0 },
    "api.groq.com": { calls: 5, tokens: 60 },
  });
  assert.deepEqual(s?.usage.bots, { "Lead Gen": 1200, "The CEO": 560 });
  assert.deepEqual(s?.usage.searches, { tavily: 4, parallel: 0 });
  assert.equal(snapshot({}, {}), null);
});

test("a later reading keeps each counter's highest value", () => {
  const a = snapshot(CALLS, {})!.usage;
  const b = snapshot({ ...CALLS, counts: { "api.z.ai": 950 }, usage: {}, by_bot: { "Lead Gen": 1500 } }, {})!.usage;
  const m = mergeDay(a, b);
  assert.deepEqual(m.hosts["api.z.ai"], { calls: 950, tokens: 1700 });
  assert.equal(m.bots["Lead Gen"], 1500);
  assert.equal(m.bots["The CEO"], 560);
});

test("recordUsage writes one entry per day and only usage-history.json", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-"));
  await writeFile(path.join(dir, "model_calls.json"), JSON.stringify(CALLS));
  await writeFile(path.join(dir, "tavily-usage.json"), JSON.stringify({ "2026-11-05": 3 }));
  assert.equal(await recordUsage(dir), "2026-11-05");
  await writeFile(path.join(dir, "model_calls.json"), JSON.stringify({ ...CALLS, day: "2026-11-06", counts: { gemini: 2 }, usage: {}, by_bot: {} }));
  await recordUsage(dir);
  const h = await readHistory(dir);
  assert.deepEqual(Object.keys(h.days).sort(), ["2026-11-05", "2026-11-06"]);
  assert.equal(h.since, "2026-11-05");
  assert.equal(h.days["2026-11-05"].searches.tavily, 3);
  assert.equal(JSON.parse(await readFile(path.join(dir, "model_calls.json"), "utf8")).day, "2026-11-06"); // untouched
});

test("periods: days for a month, weeks from Monday for 3 months and a quarter, months for a year", () => {
  const m = periodRange("month", "2026-11-05");
  assert.equal(m.from, "2026-11-01");
  assert.equal(m.buckets.length, 5);
  const q = periodRange("3months", "2026-11-05");
  assert.equal(q.from, "2026-09-01");
  assert.equal(q.label, "Sep to Nov 2026");
  assert.equal(q.buckets[0].from, "2026-09-01"); // the first week starts on the period's first day
  assert.equal(q.buckets[1].from, "2026-09-07"); // then Mondays
  assert.equal(q.buckets.at(-1)!.to, "2026-11-05");
  assert.equal(periodRange("quarter", "2026-11-05").from, "2026-10-01");
  assert.equal(periodRange("3months", "2026-02-10").from, "2025-12-01");
  const y = periodRange("year", "2026-11-05");
  assert.deepEqual([y.buckets.length, y.buckets[0].label, y.buckets.at(-1)!.to], [11, "Jan", "2026-11-05"]);
});

test("a report adds up the period's days and names how many were recorded", () => {
  const day = (tokens: number, calls: number) => ({ hosts: { gemini: { calls, tokens } }, bots: { Scout: tokens }, searches: { tavily: 1 }, recordedAt: "" });
  const h: UsageHistory = { version: 1, since: "2026-10-30", days: { "2026-10-30": day(500, 5), "2026-11-02": day(100, 1), "2026-11-05": day(50, 2) } };
  const checks = { "a@x.com": { at: "2026-11-03T10:00:00" }, "b@x.com": { at: "2026-10-01T10:00:00" }, "c@x.com": { at: "2026-11-04T10:00:00", by: "sniffmail" } };
  const r = usageReport(h, checks, "month", "2026-11-05");
  assert.deepEqual(r.totals, { calls: 3, tokens: 150, searches: { tavily: 2 }, emailChecks: 1 });
  assert.deepEqual([r.daysRecorded, r.daysInPeriod, r.since], [2, 5, "2026-10-30"]);
  assert.deepEqual(r.bots, [{ name: "Scout", tokens: 150 }]);
  assert.deepEqual(r.buckets.map((b) => b.tokens), [0, 100, 0, 0, 50]);
  const q = usageReport(h, checks, "quarter", "2026-11-05");
  assert.equal(q.totals.tokens, 650);
  assert.equal(q.totals.emailChecks, 2);
});
