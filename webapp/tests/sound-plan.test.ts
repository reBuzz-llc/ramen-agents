// Run: npm test. Which of the world's sounds plays when (creatorCC queue 59).
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore TS5097
import { actCue, ambientDue, armUnlock, newSoundPlan, pickCue, woke, THUD_EVERY_MS, AMBIENT_MIN_MS, AMBIENT_MAX_MS } from "../lib/sound-plan.ts";

test("a restored 'on' plays after one click: the first pointerdown or key unlocks, once", () => {
  const page = new EventTarget();
  let unlocked = 0;
  armUnlock(page, true, () => unlocked++);
  assert.equal(unlocked, 0, "nothing before a gesture");
  page.dispatchEvent(new Event("pointerdown"));
  assert.equal(unlocked, 1, "one click starts audio");
  page.dispatchEvent(new Event("pointerdown"));
  page.dispatchEvent(new Event("keydown"));
  assert.equal(unlocked, 1, "and only once");
  const keys = new EventTarget();
  let k = 0;
  armUnlock(keys, true, () => k++);
  keys.dispatchEvent(new Event("keydown"));
  assert.equal(k, 1, "a key does it too");
  const off = new EventTarget();
  let o = 0;
  armUnlock(off, false, () => o++);
  off.dispatchEvent(new Event("pointerdown"));
  assert.equal(o, 0, "sound off: nothing armed");
});

test("cues: a tick for a note, a pop for a pinned lead, a thud for a refusal; one a poll, the most telling first", () => {
  assert.equal(actCue({ type: "note", verdict: "allowed" }), "tick");
  assert.equal(actCue({ type: "lead", verdict: "allowed" }), "pop");
  assert.equal(actCue({ type: "update_lead", verdict: "allowed" }), "pop");
  assert.equal(actCue({ type: "search", verdict: "refused" }), "thud");
  assert.equal(actCue({ type: "search", verdict: "allowed" }), null);
  const plan = newSoundPlan(1, 0);
  assert.equal(pickCue(plan, 0, ["click", "pop", "tick"]), "pop");
  assert.equal(pickCue(plan, 0, ["thud", "chime"]), "chime");
  assert.equal(pickCue(plan, 0, []), null);
  assert.equal(woke("resting until 15:30", "working"), true);
  assert.equal(woke("working", "working"), false);
  assert.equal(woke(undefined, "working"), false, "not on the first poll");
});

test("a refusal's thud at most once a minute", () => {
  const plan = newSoundPlan(1, 0);
  assert.equal(pickCue(plan, 1000, ["thud"]), "thud");
  assert.equal(pickCue(plan, 1000 + THUD_EVERY_MS - 1, ["thud"]), null, "not within the minute");
  assert.equal(pickCue(plan, 30_000, ["thud", "tick"]), "tick", "another cue still plays");
  assert.equal(pickCue(plan, 1000 + THUD_EVERY_MS, ["thud"]), "thud");
  // a refusal every 5 s for 10 minutes: ten thuds
  const p2 = newSoundPlan(2, 0);
  let n = 0;
  for (let t = 0; t < 600_000; t += 5000) if (pickCue(p2, t, ["thud"])) n++;
  assert.equal(n, 10);
});

test("ambient: one every 90-120 s, a bird call or a water lap, never the same twice in a row, seeded", () => {
  const run = (seed: number) => {
    const plan = newSoundPlan(seed, 0);
    const out: [number, string][] = [];
    for (let t = 0; t <= 3_600_000; t += 1000) {
      const k = ambientDue(plan, t);
      if (k) out.push([t, k]);
    }
    return out;
  };
  const hour = run(5959);
  assert.ok(hour.length >= 28 && hour.length <= 41, `${hour.length} in an hour`);
  assert.ok(hour[0][0] >= AMBIENT_MIN_MS && hour[0][0] <= AMBIENT_MAX_MS, "the first after 90-120 s");
  for (let i = 1; i < hour.length; i++) {
    const g = hour[i][0] - hour[i - 1][0];
    assert.ok(g >= AMBIENT_MIN_MS && g <= AMBIENT_MAX_MS + 1000, `gap ${g}`);
    assert.notEqual(hour[i][1], hour[i - 1][1], "never twice in a row");
  }
  assert.deepEqual(run(5959), hour, "seeded");
  assert.equal(ambientDue(newSoundPlan(1, 0), 1000), null, "nothing at once");
});
