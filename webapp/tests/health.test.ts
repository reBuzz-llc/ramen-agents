// Run: npm test. One fixture per health-banner condition (creatorCC queue 5, 2026-10-29).
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore TS5097
import { awakeMinutes, idleIssue, rebootIssue, restIntervals, validatorIssue } from "../lib/health.ts";

const now = new Date("2026-10-29T22:00:00").getTime();
const t = (iso: string) => new Date(iso).getTime();

test("(a) Validator: last run over 8 h, or full sweep over 30 h", () => {
  const stale = validatorIssue(JSON.stringify({ last_run: "2026-10-28T13:20:22", last_full_sweep: "2026-10-27T19:02:13" }), now);
  assert.equal(stale?.since, "2026-10-28T13:20:22");
  assert.match(stale!.text, /not run since 10-28 13:20 \(last full sweep 10-27 19:02\)/);
  const sweep = validatorIssue(JSON.stringify({ last_run: "2026-10-29T21:00:00", last_full_sweep: "2026-10-28T10:00:00" }), now);
  assert.match(sweep!.text, /full sweep was 10-28 10:00/);
  assert.equal(validatorIssue(JSON.stringify({ last_run: "2026-10-29T21:00:00", last_full_sweep: "2026-10-29T08:00:00" }), now), null);
});

test("(b) reboot: only an unplanned one", () => {
  const off = [
    { from: "2026-10-29T08:00:00", to: "2026-10-29T08:01:00", note: "shut down" },
    { from: "2026-10-29T10:04:00", to: "2026-10-29T19:05:00", note: "no clean shutdown logged" },
  ];
  assert.match(rebootIssue(off)!.text, /without a clean shutdown at 10-29 10:04 and came back at 10-29 19:05/);
  assert.equal(rebootIssue(off.slice(0, 1)), null);
});

test("(c) idle: rest, quiet and Mac-off time do not count", () => {
  const log = [
    '{"ts": "2026-10-29T17:00:00", "kind": "resting", "minutes": 30.0}',
    '{"ts": "2026-10-29T17:30:00", "kind": "day_block_rest", "minutes": 30.0}',
    '{"ts": "2026-10-29T19:06:00", "kind": "quiet", "reason": "Steam is in front"}',
    '{"ts": "2026-10-29T21:46:00", "kind": "quiet_over", "minutes": 160.0}',
  ].join("\n");
  const rests = restIntervals(log, now);
  assert.equal(rests.length, 3);
  // From 16:00: 1 h before the rests, 18:00-19:06 awake, 21:46-22:00 awake.
  assert.equal(Math.round(awakeMinutes(t("2026-10-29T16:00:00"), now, rests)), 60 + 66 + 14);
  const idle = idleIssue("Lead Gen", "2026-10-29T16:00:00", rests, [], now);
  assert.match(idle!.text, /Lead Gen has had no accepted action since 10-29 16:00 \(2 h 20 min awake/);
  // The same gap with the Mac off 18:00-19:06 drops under 2 h.
  assert.equal(idleIssue("Lead Gen", "2026-10-29T16:00:00", rests, [[t("2026-10-29T18:00:00"), t("2026-10-29T19:06:00")]], now), null);
});

test("(c) a quiet still open covers up to now", () => {
  const rests = restIntervals('{"ts": "2026-10-29T12:00:00", "kind": "quiet", "reason": "x"}', now);
  assert.equal(idleIssue("Scout", "2026-10-29T11:00:00", rests, [], now), null);
});
