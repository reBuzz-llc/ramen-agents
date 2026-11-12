// The Validator's last tick on the provider pages (creatorCC queue 315): its age, red past 30 minutes or with no report.
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore TS5097
import { TICK_STALE_MIN, tickLine, tickOf } from "../lib/tick.ts";

const at = "2026-11-08T15:49:35"; // local time, no zone, as the Validator writes it
const base = new Date(at).getTime();

test("a fresh tick: its time and age, not stale", () => {
  const t = tickOf(at, base + 3 * 60_000);
  assert.deepEqual(t, { at, minutes: 3, stale: false });
  assert.equal(tickLine(t), "Last tick 15:49 (3 min ago)");
  assert.equal(tickLine(tickOf(at, base + 20_000)), "Last tick 15:49 (just now)");
});

test("exactly 30 minutes is still fine; 31 is stale and says why", () => {
  assert.equal(TICK_STALE_MIN, 30);
  assert.equal(tickOf(at, base + 30 * 60_000).stale, false);
  const t = tickOf(at, base + 31 * 60_000);
  assert.equal(t.stale, true);
  assert.match(tickLine(t), /^Last tick 15:49 \(31 min ago\): the Validator has not reported for over 30 minutes/);
  assert.match(tickLine(tickOf(at, base + 3 * 3600_000)), /\(3 h ago\)/);
});

test("no report, or no readable time, is stale", () => {
  for (const bad of [null, undefined, "", "yesterday", 42]) {
    const t = tickOf(bad, base);
    assert.deepEqual(t, { at: null, minutes: null, stale: true });
    assert.match(tickLine(t), /^No tick report from the Validator/);
  }
});
