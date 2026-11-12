// Run: npm test. The Work plan's stopped toggle split, the #fragment and the past-job line (creatorCC
// queue 20, 2026-10-30).
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore TS5097
import { attempts, endedLine, historyEntry, lastEnded, noPlanHeader, partition, pastDay, pastKey, pastLine, readHash, TAB_PATH, tabOfPath } from "../lib/work-plan-rows.ts";

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

// queue 56: a card with no plan in hand shows its last ended plan under a header, never an empty box.
test("no plan: a fixture bot without plan.json shows its last ended plan from plan-history.jsonl", async () => {
  const { readFile, stat } = await import("node:fs/promises");
  const ws = new URL("./fixtures/no-plan-bot/workspace/", import.meta.url);
  await assert.rejects(stat(new URL("plan.json", ws)));
  const last = lastEnded(await readFile(new URL("plan-history.jsonl", ws), "utf8"));
  assert.deepEqual(last, {
    task: "Enrich Art for Film",
    status: "stuck",
    ended: "2026-10-31T15:50:42",
    note: "update_lead blocked until tomorrow",
    steps: [
      { text: "open the listing", done: true },
      { text: "confirm size and industry", done: false },
    ],
  });
  assert.equal(endedLine(last!, "2026-10-31"), "ended 15:50 · stuck");
  assert.equal(endedLine({ ended: "2026-10-30T23:31:49", status: "done" }, "2026-10-31"), "ended 10-30 23:31 · done");
  assert.equal(lastEnded(""), null);
  assert.equal(historyEntry("{"), null);
});

test("no plan header: the board's state and last action, or stopped by the owner", () => {
  assert.equal(noPlanHeader({ state: "working", last: "opened bluecanary.com" }), "No plan right now · working: opened bluecanary.com");
  assert.equal(noPlanHeader({ state: "resting", last: null }), "No plan right now · resting");
  assert.equal(noPlanHeader({}), "No plan right now");
  assert.equal(noPlanHeader({ stoppedSince: "2026-10-30", state: "working" }), "stopped by the owner since 2026-10-30");
  assert.equal(noPlanHeader({ stoppedSince: "2026-10-14", retired: true }), "retired since 2026-10-14");
});

test("sections are pages: each tab has its own path, and a path names its tab", () => {
  assert.deepEqual(TAB_PATH, { plan: "/work-plan", past: "/work-plan/past", leads: "/work-plan/leads", checks: "/work-plan/checks" });
  for (const [tab, path] of Object.entries(TAB_PATH)) assert.equal(tabOfPath(path), tab);
  assert.equal(tabOfPath("/work-plan/past/"), "past");
  assert.equal(tabOfPath("/settings"), null);
});

// queue 80: the Past jobs page names repeated attempts, groups by day and keeps an open row on its job.
test("past jobs: attempts of the same task, day headings, a stable key", () => {
  const j = (slug: string, task: string, started: string) => ({ slug, task, started, ended: started.replace("T0", "T1") });
  const jobs = [j("lead-gen", "Find NYC leads", "2026-11-02T09:00:00"), j("lead-gen", "find nyc leads ", "2026-11-01T09:00:00"), j("scout", "Find NYC leads", "2026-11-02T08:00:00"), j("lead-gen", "Other", "2026-11-02T07:00:00")];
  const a = attempts(jobs);
  assert.equal(a.get(pastKey(jobs[1])), "attempt 1 of 2");
  assert.equal(a.get(pastKey(jobs[0])), "attempt 2 of 2");
  assert.equal(a.get(pastKey(jobs[2])), undefined); // another bot's plan is not an attempt of this one
  assert.equal(a.get(pastKey(jobs[3])), undefined);
  const now = new Date("2026-11-02T23:30:00");
  assert.deepEqual([pastDay("2026-11-02T10:00:00", now), pastDay("2026-11-01T23:59:00", now), pastDay("2026-10-31T08:00:00", now), pastDay(null, now)], ["Today", "Yesterday", "Sat 31 Oct", "Undated"]);
  assert.notEqual(pastKey(jobs[0]), pastKey(jobs[1]));
});
