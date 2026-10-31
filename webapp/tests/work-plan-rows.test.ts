// Run: npm test. The Work plan's stopped toggle split, the #fragment and the past-job line (
// queue 20, 2026-10-30).
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore TS5097
import { partition, pastLine, readHash } from "../lib/work-plan-rows.ts";

test("stopped toggle: running in order, stopped apart", () => {
  const cards = [
    { slug: "a", stopped: false },
    { slug: "s1", stopped: true },
    { slug: "b", stopped: false },
    { slug: "s2", stopped: true },
  ];
  const p = partition(cards);
  assert.deepEqual(p.running.map((c) => c.slug), ["a", "b"]);
  assert.deepEqual(p.stopped.map((c) => c.slug), ["s1", "s2"]);
});

test("expand one: #<slug> opens that row on the plan tab; tabs and old links", () => {
  const slugs = ["lead-gen", "the-ceo"];
  assert.deepEqual(readHash("#lead-gen", slugs), { tab: "plan", open: "lead-gen" });
  assert.deepEqual(readHash("#past", slugs), { tab: "past", open: null });
  assert.deepEqual(readHash("#checks", slugs), { tab: "checks", open: null });
  assert.deepEqual(readHash("#target", slugs), { tab: "plan", open: null });
  assert.deepEqual(readHash("", slugs), { tab: "plan", open: null });
});

test("past job line: bot, task, when, how it ended, active minutes", () => {
  assert.deepEqual(
    pastLine({ name: "Lead Gen", task: "Clear pending leads", started: "2026-10-30T09:00:00", ended: "2026-10-30T11:30:00", status: "done", activeMin: 95 }),
    { bot: "Lead Gen", task: "Clear pending leads", when: "10-30 09:00 to 11:30", ended: "done", active: "1 h 35 min active" },
  );
  const l = pastLine({ name: "The CEO", task: "", started: "2026-10-28T22:00:00", ended: "2026-10-29T08:00:00", status: "set_aside", activeMin: null });
  assert.equal(l.when, "10-28 22:00 to 10-29 08:00");
  assert.equal(l.ended, "set aside");
  assert.equal(l.active, "—");
  assert.equal(l.task, "(untitled job)");
});
