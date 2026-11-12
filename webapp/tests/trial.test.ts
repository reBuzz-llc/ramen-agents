// A planned pause of the family (creatorCC queue 371): one calm line, and the red lines it explains stay quiet.
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore TS5097
import { quietDuringTrial, TRIAL_PREFIX, trialOf } from "../lib/trial.ts";
// @ts-ignore TS5097
import { pausedTick, tickLine, tickOf } from "../lib/tick.ts";

test("the Validator's pause file gives the window", () => {
  const t = trialOf({ from: "2026-11-10T01:56:00", to: "2026-11-10T03:15:00", reason: "judge trial" }, [], { now: new Date(2026, 10, 10, 2, 30).getTime() });
  assert.equal(t?.line, "Judge trial running 01:56-03:15: the family and the Validator are paused on purpose");
});

test("a STOP line alone is enough, its 'back by' time the end; other STOPs are not a trial", () => {
  assert.equal(trialOf(null, ["", "valiCC: judge trial, back by 03:15"], { now: new Date(2026, 10, 10, 2, 30).getTime() })?.line, "Judge trial running until 03:15: the family and the Validator are paused on purpose");
  assert.equal(trialOf(null, ["owner stopped it 11-06", ""]), null);
  assert.equal(trialOf(null, []), null);
  assert.ok(TRIAL_PREFIX.startsWith("valiCC"));
});

test("an unreadable pause file still counts: the file is there", () => {
  assert.equal(trialOf({}, [])?.line, "Judge trial running: the family and the Validator are paused on purpose");
});

test("during a trial the Validator and idle lines are quiet, the rest stays", () => {
  const issues = [{ key: "validator" }, { key: "idle:Scout" }, { key: "reboot" }, { key: "validator-job:backfill" }];
  const t = trialOf({ from: "01:56", to: "03:15" }, [], { now: new Date(2026, 10, 10, 2, 30).getTime() });
  assert.deepEqual(quietDuringTrial(issues, t).map((i: { key: string }) => i.key), ["reboot", "validator-job:backfill"]);
  assert.equal(quietDuringTrial(issues, null).length, 4);
});

test("an old tick during a trial is not red, and says why", () => {
  const at = "2026-11-10T01:50:00";
  const stale = tickOf(at, new Date(at).getTime() + 90 * 60_000);
  assert.equal(stale.stale, true);
  const t = pausedTick(stale, "Judge trial running 01:56-03:15: the family and the Validator are paused on purpose");
  assert.equal(t.stale, false);
  assert.equal(tickLine(t), "Judge trial running 01:56-03:15: the family and the Validator are paused on purpose.");
  assert.deepEqual(pausedTick(stale, null), stale);
});

test("after the end plus 30 minutes the pause explains nothing: a crashed trial cannot hide a dead Validator", () => {
  const file = { from: "2026-11-10T01:56:00", to: "2026-11-10T03:15:00", reason: "judge trial" };
  const t = (h: number, m: number) => new Date(2026, 10, 10, h, m).getTime();
  assert.ok(trialOf(file, [], { now: t(3, 40) }));
  assert.equal(trialOf(file, [], { now: t(3, 46) }), null);
  // a bare "back by 03:15" is the first 03:15 after the STOP was written (22:50 the evening before)
  const stops = ["valiCC: judge trial, back by 03:15"];
  const written = new Date(2026, 10, 9, 22, 50).getTime();
  assert.ok(trialOf(null, stops, { now: new Date(2026, 10, 9, 23, 30).getTime(), stopAt: [written] }));
  assert.ok(trialOf(null, stops, { now: t(3, 44), stopAt: [written] }));
  assert.equal(trialOf(null, stops, { now: t(7, 0), stopAt: [written] }), null);
  // no end at all: six hours after it was written
  assert.ok(trialOf({}, [], { now: t(4, 0), pausedAt: t(1, 0) }));
  assert.equal(trialOf({}, [], { now: t(7, 1), pausedAt: t(1, 0) }), null);
});
