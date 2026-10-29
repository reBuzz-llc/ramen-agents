// Run: npm test. One fixture per health-banner condition (creatorCC queue 5, 2026-10-29).
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore TS5097
import { awakeMinutes, idleIssue, providerIssue, providerStrip, rebootIssue, restIntervals, validatorIssue } from "../lib/health.ts";

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

const calls = (health: object | undefined) =>
  JSON.stringify({ day: "2026-10-29", counts: { "api.groq.com": 18, "api.z.ai": 1014 }, ...(health ? { health } : {}) });

test("(d) provider: healthy, failing under an hour, failing over an hour, health missing", () => {
  const healthy = calls({ "api.z.ai": { last_ok: "2026-10-29T21:50:00", last_fail: "2026-10-29T21:40:00", last_reason: "rate limit" } });
  assert.equal(providerIssue(healthy, now), null);
  const brief = calls({ "api.z.ai": { last_ok: "2026-10-29T21:30:00", last_fail: "2026-10-29T21:55:00", last_reason: "rate limit" } });
  assert.equal(providerIssue(brief, now), null);
  const down = calls({ "api.z.ai": { last_ok: "2026-10-29T20:03:00", last_fail: "2026-10-29T21:58:00", last_reason: "rate limit" }, "api.groq.com": { last_ok: "2026-10-29T21:59:00" } });
  const i = providerIssue(down, now);
  assert.equal(i?.text, "The main model provider api.z.ai has not answered since 10-29 20:03 (rate limit).");
  // first_fail (engine d465e06) measures the outage: last answer before a Mac-off gap, failing only 20 min since waking.
  const woke = calls({ "api.z.ai": { last_ok: "2026-10-29T10:00:00", last_fail: "2026-10-29T21:58:00", first_fail: "2026-10-29T21:40:00", last_reason: "rate limit" } });
  assert.equal(providerIssue(woke, now), null);
  const long = calls({ "api.z.ai": { last_ok: "2026-10-29T10:00:00", last_fail: "2026-10-29T21:58:00", first_fail: "2026-10-29T20:30:00", last_reason: "rate limit" } });
  assert.equal(providerIssue(long, now)?.text, "The main model provider api.z.ai has not answered since 10-29 20:30 (rate limit).");
  assert.equal(providerIssue(calls(undefined), now), null);
  assert.equal(providerIssue(calls({}), now), null);
  assert.equal(providerIssue("not json", now), null);
});

test("provider strip: most calls first, a dot only where health is logged", () => {
  const s = providerStrip(calls({ "api.z.ai": { last_ok: "2026-10-29T20:03:00", last_fail: "2026-10-29T21:58:00" } }));
  assert.deepEqual(s, [
    { host: "api.z.ai", calls: 1014, ok: false },
    { host: "api.groq.com", calls: 18, ok: null },
  ]);
});
