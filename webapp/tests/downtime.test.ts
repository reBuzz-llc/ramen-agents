// Run: npm test. A fake `last reboot shutdown` output and a fixture explorer.jsonl (2026-10-29).
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore TS5097
import { downtime, parseLast } from "../lib/downtime.ts";
// @ts-ignore TS5097
import { parseOkr } from "../lib/family-stats.ts";

const now = new Date("2026-10-29T22:00:00").getTime();
const LAST = [
  "reboot time                                Thu Oct 29 19:05",
  "reboot time                                Sun Oct 25 12:16",
  "shutdown time                              Sun Oct 25 12:15",
  "reboot time                                Wed Dec 31 10:00", // last year's
  "",
  "wtmp begins Mon Sep  1 00:00",
].join("\n");
const JSONL = [
  '{"ts": "2026-10-29T09:00:00", "kind": "action"}',
  '{"ts": "2026-10-29T19:06:41", "kind": "quiet", "reason": "Steam is in front"}',
  '{"ts": "2026-10-29T19:20:00", "kind": "quiet", "reason": "Steam is in front"}', // a repeat while quiet
  '{"ts": "2026-10-29T21:47:00", "kind": "quiet_over", "minutes": 160.3}',
].join("\n");
// The latest bot action before the 19:05 boot: 10:04.
const lastAction = async () => new Date("2026-10-29T10:04:00").getTime();

test("last: parsed oldest first, a date after now is last year's", () => {
  const ev = parseLast(LAST, now);
  assert.equal(ev.length, 4);
  assert.equal(new Date(ev[0].at).getFullYear(), 2025);
  assert.deepEqual(ev.slice(1).map((e) => e.kind), ["shutdown", "reboot", "reboot"]);
});

test("24 h: the unplanned off gap starts at the last action; quiet from quiet_over", async () => {
  const d = await downtime(LAST, [JSONL], now - 86400e3, now, lastAction);
  assert.equal(d.off.length, 1);
  assert.equal(d.off[0].from, "2026-10-29T10:04:00");
  assert.equal(d.off[0].note, "no clean shutdown logged");
  assert.equal(d.quiet.length, 1);
  assert.equal(d.quietMin, 160);
  assert.equal(d.quiet[0].note, "Steam is in front");
});

test("7 d: the clean restart counts from its shutdown", async () => {
  const d = await downtime(LAST, [JSONL], now - 7 * 86400e3, now, lastAction);
  assert.deepEqual(d.off.map((s) => s.minutes), [1, 541]);
  assert.equal(d.off[0].note, "shut down");
});

test("a quiet still open runs to now", async () => {
  const d = await downtime("", ['{"ts": "2026-10-29T21:30:00", "kind": "quiet", "reason": "Steam is in front"}'], now - 86400e3, now, lastAction);
  assert.equal(d.quietMin, 30);
  assert.match(d.quiet[0].note, /still quiet/);
});

test("okr: objective, key results and their progress lines", () => {
  const o = parseOkr("# This week's objective (2026-10-27 to 2026-11-02)\n\nObjective: first replies.\n\n1. Send 30.\n   Progress (2026-10-29 07:47): 0 -- target 30.\n2. 3 replies.\n");
  assert.equal(o?.week, "10-27 to 11-02");
  assert.equal(o?.krs.length, 2);
  assert.equal(o?.krs[0].progress, "0 -- target 30.");
  assert.equal(o?.krs[1].progress, "");
});
