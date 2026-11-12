// The CEO's own changes in the Decisions box (valiCC queue 411): the read, the line, and Undo for each kind, with the
// "changed since" refusal, the seven days, the indents, the lock and the record's undone fields.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error TS5097
import { CHANGED_SINCE, canUndo, parseChanges, partOf, same, sideText, undo } from "../lib/ceo-changes.ts";
// @ts-expect-error TS5097
import { board, decide, parseProposals } from "../lib/ceo-proposals.ts";

const NOW = new Date(2026, 10, 10, 18, 0, 0).getTime();
const base = { reason: "fewer refusals", metric: "refusal rate", expected: "down 5 pts", applied_at: "2026-11-10T17:40:00", undo_until: "2026-11-17T17:40:00" };
const C3 = { id: "c3", text: "Read the lead's own site first", by: "ceo" };
const R2 = { id: "r2", text: "Owner rule two" };
const C1 = { id: "c1", text: "Old CEO rule", by: "ceo" };
const C1_EDITED = { id: "c1", text: "New CEO rule", by: "ceo" };

const records = () => [
  { id: "p-open", ts: "2026-11-10T09:00:00", bot: "lead-gen", change: { kind: "goal", text: "x" }, status: "open" },
  { id: "a-goal", ts: "2026-11-10T17:40:00", bot: "lead-gen", change: { kind: "goal", text: "New goal" }, field: "work-plan.json bots.lead-gen.goal", before: "Old goal", after: "New goal", status: "applied", ...base },
  { id: "a-add", ts: "2026-11-10T17:41:00", bot: "lead-gen", change: { kind: "add_rule", text: C3.text }, field: "work-plan.json bots.lead-gen.rules", before: null, after: C3, status: "applied", ...base, applied_at: "2026-11-10T17:41:00" },
  { id: "a-edit", ts: "2026-11-10T17:42:00", bot: "lead-gen", change: { kind: "edit_rule", rule_id: "c1" }, field: "work-plan.json bots.lead-gen.rules", before: C1, after: C1_EDITED, status: "applied", ...base, applied_at: "2026-11-10T17:42:00" },
  { id: "a-drop", ts: "2026-11-10T17:43:00", bot: "outreach-writer", change: { kind: "drop_rule", rule_id: "c2" }, field: "work-plan.json bots.outreach-writer.rules", before: { id: "c2", text: "Dropped CEO rule", by: "ceo" }, after: null, status: "applied", ...base, applied_at: "2026-11-10T17:43:00" },
  { id: "a-num", ts: "2026-11-10T17:44:00", bot: "scout", change: { kind: "daily_goal", number: 2 }, field: "daily-goals.json scout", before: 1, after: 2, status: "applied", ...base, applied_at: "2026-11-10T17:44:00" },
  { id: "a-old", ts: "2026-11-01T10:00:00", bot: "scout", change: { kind: "daily_goal", number: 3 }, field: "daily-goals.json scout", before: 1, after: 3, status: "applied", ...base, applied_at: "2026-11-01T10:00:00", undo_until: "2026-11-08T10:00:00" },
  { id: "a-rev", ts: "2026-11-09T10:00:00", bot: "scout", change: { kind: "daily_goal", number: 9 }, field: "daily-goals.json scout", before: 1, after: 9, status: "reverted", ...base, applied_at: "2026-11-09T10:00:00", reverted_at: "2026-11-09T11:00:00", validator_note: "over the cap" },
  { id: "a-other", ts: "2026-11-10T17:45:00", bot: "scout", change: { kind: "goal" }, field: "work-plan.json bots.lead-gen.goal", before: "a", after: "b", status: "applied", ...base, applied_at: "2026-11-10T17:45:00" },
];

async function fixture(plan?: unknown, goals?: unknown) {
  const dir = await mkdtemp(path.join(tmpdir(), "ceo-changes-"));
  const files = { proposals: path.join(dir, "ceo-proposals.json"), plan: path.join(dir, "work-plan.json"), goals: path.join(dir, "daily-goals.json"), applied: path.join(dir, "applied.jsonl") };
  await writeFile(files.proposals, JSON.stringify({ version: 1, proposals: records() }, null, 1));
  await writeFile(
    files.plan,
    JSON.stringify(plan ?? { version: 1, updatedAt: "2026-11-10T17:44:00", bots: { "lead-gen": { goal: "New goal", rules: [{ id: "r1", text: "Owner rule one" }, C1_EDITED, R2, C3] }, "outreach-writer": { goal: "Write", rules: [{ id: "r1", text: "Owner" }] } } }, null, 1) + "\n",
  );
  await writeFile(files.goals, JSON.stringify(goals ?? { _note: "targets · owner edits", "lead-gen": 10, scout: 2 }, null, 2) + "\n");
  return files;
}

test("the read: applied, undone and reverted records, newest first; proposals and open records are not changes", () => {
  const list = parseChanges(JSON.stringify({ proposals: records() }));
  assert.deepEqual(list.map((c) => c.id), ["a-other", "a-num", "a-drop", "a-edit", "a-add", "a-goal", "a-rev", "a-old"]);
  assert.equal(list.find((c) => c.id === "a-other")?.part, null); // a field for another bot: shown, never undone
  assert.equal(partOf("daily-goals.json scout", "scout"), "daily_goal");
  assert.equal(partOf("work-plan.json bots.scout.rules", "scout"), "rules");
  assert.deepEqual(parseChanges("nope"), []);
  // and the step-one proposals list leaves the CEO's changes out (they used to read as open)
  assert.deepEqual(parseProposals(JSON.stringify({ proposals: records() })).map((p) => p.id), ["p-open"]);
});

test("the line's two sides and when Undo shows", () => {
  const by = Object.fromEntries(parseChanges(JSON.stringify({ proposals: records() })).map((c) => [c.id, c]));
  assert.equal(sideText(by["a-add"], "before"), "(new rule)");
  assert.equal(sideText(by["a-add"], "after"), C3.text);
  assert.equal(sideText(by["a-drop"], "after"), "(dropped)");
  assert.equal(sideText(by["a-goal"], "before"), "Old goal");
  assert.equal(sideText(by["a-num"], "after"), "2");
  assert.equal(canUndo(by["a-goal"], NOW), true);
  assert.equal(canUndo(by["a-old"], NOW), false); // its seven days are over
  assert.equal(canUndo(by["a-rev"], NOW), false);
  assert.equal(canUndo(by["a-other"], NOW), false);
  assert.equal(canUndo(by["a-goal"], new Date(2026, 10, 17, 17, 40, 0).getTime()), false); // at undo_until: over
  assert.equal(same({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }), true);
});

test("Undo, each kind: before goes back, the plan keeps indent 1 and gets updatedAt, the record is undone", async () => {
  const files = await fixture();
  for (const id of ["a-goal", "a-add", "a-edit", "a-drop"]) {
    const r = await undo(id, "owner", files, NOW);
    assert.equal(r.ok, true, `${id}: ${r.ok ? "" : r.error}`);
  }
  const planText = await readFile(files.plan, "utf8");
  assert.match(planText, /^\{\n "version"/); // indent 1
  const plan = JSON.parse(planText);
  assert.equal(plan.updatedAt, "2026-11-10T18:00:00");
  assert.equal(plan.bots["lead-gen"].goal, "Old goal");
  assert.deepEqual(plan.bots["lead-gen"].rules, [{ id: "r1", text: "Owner rule one" }, C1, R2]); // c3 gone, c1 its old text
  assert.deepEqual(plan.bots["outreach-writer"].rules, [{ id: "r1", text: "Owner" }, { id: "c2", text: "Dropped CEO rule", by: "ceo" }]);
  const recs = JSON.parse(await readFile(files.proposals, "utf8")).proposals;
  const goal = recs.find((r: { id: string }) => r.id === "a-goal");
  assert.equal(goal.status, "undone");
  assert.equal(goal.undone_at, "2026-11-10T18:00:00");
  assert.equal(goal.undone_by, "owner");
  assert.equal(goal.reason, "fewer refusals"); // the rest kept
  const log = (await readFile(files.applied, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(log.length, 4);
  assert.deepEqual([log[0].before, log[0].after, log[0].undo], ["New goal", "Old goal", true]);
  await assert.rejects(stat(`${files.proposals}.lock`));
  await assert.rejects(stat(`${files.plan}.lock`));
  assert.deepEqual(await undo("a-goal", "x", files, NOW), { ok: false, error: "already undone" });
});

test("Undo a daily number: daily-goals.json keeps indent 2 and its notes", async () => {
  const files = await fixture();
  assert.equal((await undo("a-num", "Owner", files, NOW)).ok, true);
  const text = await readFile(files.goals, "utf8");
  assert.match(text, /^\{\n {2}"_note"/);
  assert.deepEqual(JSON.parse(text), { _note: "targets · owner edits", "lead-gen": 10, scout: 1 });
});

test("changed since: nothing is written and the record stays applied", async () => {
  const files = await fixture({ version: 1, updatedAt: "x", bots: { "lead-gen": { goal: "The owner's own goal now", rules: [{ ...C3, text: "reworded by the owner" }] } } }, { scout: 5 });
  const before = await readFile(files.plan, "utf8");
  for (const id of ["a-goal", "a-add", "a-num"]) assert.deepEqual(await undo(id, "Owner", files, NOW), { ok: false, error: CHANGED_SINCE });
  assert.equal(await readFile(files.plan, "utf8"), before);
  assert.deepEqual(JSON.parse(await readFile(files.goals, "utf8")), { scout: 5 });
  const recs = JSON.parse(await readFile(files.proposals, "utf8")).proposals;
  assert.equal(recs.find((r: { id: string }) => r.id === "a-goal").status, "applied");
});

test("refused: past seven days, a reverted one, another bot's field, an unknown id; a stale lock is broken", async () => {
  const files = await fixture();
  assert.deepEqual(await undo("a-old", "Owner", files, NOW), { ok: false, error: "the seven days to undo it are over" });
  assert.deepEqual(await undo("a-rev", "Owner", files, NOW), { ok: false, error: "already reverted" });
  assert.equal((await undo("a-other", "Owner", files, NOW)).ok, false);
  assert.deepEqual(await undo("nope", "Owner", files, NOW), { ok: false, error: "no such CEO change" });
  await mkdir(`${files.plan}.lock`);
  const old = new Date(Date.now() - 60_000);
  await utimes(`${files.plan}.lock`, old, old);
  assert.equal((await undo("a-goal", "Owner", files, NOW)).ok, true);
});

test("approving a step-one proposal keeps The CEO's rules (c ids, by ceo) and numbers new owner rules from r", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ceo-approve-"));
  const files = { proposals: path.join(dir, "ceo-proposals.json"), plan: path.join(dir, "work-plan.json"), applied: path.join(dir, "applied.jsonl") };
  await writeFile(files.proposals, JSON.stringify({ version: 1, proposals: [{ id: "p1", ts: "2026-11-10T09:00:00", bot: "lead-gen", change: { kind: "add_rule", text: "Skip chains" }, status: "open" }] }));
  await writeFile(files.plan, JSON.stringify({ version: 1, updatedAt: null, bots: { "lead-gen": { goal: "g", rules: [{ id: "r1", text: "one" }, { id: "c7", text: "ceo rule", by: "ceo" }] } } }));
  const r = await decide("p1", true, "", files, NOW);
  assert.equal(r.ok, true);
  const plan = JSON.parse(await readFile(files.plan, "utf8"));
  assert.deepEqual(plan.bots["lead-gen"].rules, [{ id: "r1", text: "one" }, { id: "c7", text: "ceo rule", by: "ceo" }, { id: "r2", text: "Skip chains" }]);
});

test("an expired proposal (queue 425) lists as decided at its expired_at with its note, never as open or a change", async () => {
  const text = JSON.stringify({ proposals: [{ id: "p-x", ts: "2026-11-10T06:29:35", bot: "lead-gen", change: { kind: "add_rule", text: "Skip chains" }, status: "expired", expired_at: "2026-11-11T09:00:00", expired_note: "superseded by self-steering step two (11-10)" }] });
  const list = parseProposals(text);
  assert.equal(list[0].status, "expired");
  assert.equal(list[0].decided_at, "2026-11-11T09:00:00");
  assert.equal(list[0].expired_note, "superseded by self-steering step two (11-10)");
  const b = board(list, new Date(2026, 10, 11, 12, 0).getTime());
  assert.deepEqual([b.open.length, b.decided.map((p: { id: string }) => p.id)], [0, ["p-x"]]);
  assert.deepEqual(parseChanges(text), []);
  const files = { proposals: path.join(await mkdtemp(path.join(tmpdir(), "ceo-exp-")), "p.json"), plan: "/nonexistent", applied: "/nonexistent" };
  await writeFile(files.proposals, text);
  assert.deepEqual(await decide("p-x", true, "", files, NOW), { ok: false, error: "already expired" });
});
