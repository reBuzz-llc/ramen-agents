// Run: npm test. A fixture ceo-proposals.json and work-plan.json in a temp folder (2026-10-30).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-ignore TS5097
import { board, decide, describe, parseProposals, readBoard } from "../lib/ceo-proposals.ts";

const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime();
const prop = (id: string, bot: string, change: unknown, extra: Record<string, unknown> = {}) => ({
  id,
  ts: "2026-10-30T09:15:00",
  bot,
  change,
  reason: "Lead Gen lists chains the team never sends to",
  metric: "leads listed",
  expected: "fewer leads, more of them sendable",
  status: "open",
  ...extra,
});

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "ceo-prop-"));
  const files = { proposals: path.join(dir, "ceo-proposals.json"), plan: path.join(dir, "work-plan.json"), applied: path.join(dir, "applied.jsonl") };
  await writeFile(
    files.proposals,
    JSON.stringify({
      version: 1,
      proposals: [
        prop("p-1-lead-gen", "lead-gen", { kind: "goal", text: "List 5 independent NYC shops a day with a working email" }, { validator_note: "Fits the OKR", validator_note_at: "2026-10-30T09:20:00", future: 1 }),
        prop("p-2-lead-gen", "lead-gen", { kind: "add_rule", text: "Skip chains and franchises" }),
        prop("p-3-lead-gen", "lead-gen", { kind: "drop_rule", rule_id: "r1", text: "Search for businesses, not articles or lists" }),
        prop("p-4-the-ceo", "the-ceo", { kind: "drop_rule", rule_id: "r7", text: "gone" }),
        prop("p-5-lead-gen", "lead-gen", { kind: "teleport" }),
        prop("p-6-old", "lead-gen", { kind: "goal", text: "x" }, { status: "declined", decided_at: "2026-10-20T10:00:00" }),
        prop("p-7-recent", "lead-gen", { kind: "goal", text: "y" }, { status: "approved", decided_at: "2026-10-29T10:00:00" }),
        { id: "", bot: "nobody" },
      ],
    }),
  );
  await writeFile(
    files.plan,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-10-18T15:29:18.554Z",
      bots: {
        "lead-gen": { goal: "follow The CEO instructions.", rules: [{ id: "r1", text: "Search for businesses, not articles or lists" }, { id: "r2", text: "Check each one's own website" }] },
        "package-designer": { goal: "keep me", rules: [] },
      },
    }),
  );
  return files;
}

test("render: open ones oldest first, decided ones only from the last 7 days, malformed skipped", async () => {
  const files = await fixture();
  const b = await readBoard(files, NOW);
  assert.deepEqual(b.open.map((p: { id: string }) => p.id), ["p-1-lead-gen", "p-2-lead-gen", "p-3-lead-gen", "p-4-the-ceo", "p-5-lead-gen"]);
  assert.deepEqual(b.decided.map((p: { id: string }) => p.id), ["p-7-recent"]);
  assert.equal(b.open[0].validator_note, "Fits the OKR");
  assert.equal(describe(b.open[0].change), "New goal: List 5 independent NYC shops a day with a working email");
  assert.equal(describe(b.open[2].change), "Drop rule r1: Search for businesses, not articles or lists");
  assert.equal(b.open[4].change, null);
  assert.deepEqual(board(parseProposals("not json"), NOW), { open: [], decided: [] });
});

test("approve a goal: work plan changed for that bot only, log line written, status and note saved, fields kept", async () => {
  const files = await fixture();
  const r = await decide("p-1-lead-gen", true, "  yes,   try it  ", files, NOW);
  assert.equal(r.ok, true);
  const plan = JSON.parse(await readFile(files.plan, "utf8"));
  assert.equal(plan.bots["lead-gen"].goal, "List 5 independent NYC shops a day with a working email");
  assert.equal(plan.bots["lead-gen"].rules.length, 2);
  assert.deepEqual(plan.bots["package-designer"], { goal: "keep me", rules: [] });
  const log = (await readFile(files.applied, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(log.length, 1);
  assert.equal(log[0].id, "p-1-lead-gen");
  assert.equal(log[0].before.goal, "follow The CEO instructions.");
  assert.equal(log[0].after.goal, "List 5 independent NYC shops a day with a working email");
  assert.equal(log[0].ts, "2026-10-30T12:00:00");
  const doc = JSON.parse(await readFile(files.proposals, "utf8"));
  const rec = doc.proposals[0];
  assert.equal(rec.status, "approved");
  assert.equal(rec.owner_note, "yes, try it");
  assert.equal(rec.decided_at, "2026-10-30T12:00:00");
  assert.equal(rec.future, 1);
  assert.equal(rec.validator_note_at, "2026-10-30T09:20:00");
  assert.deepEqual(await decide("p-1-lead-gen", true, "", files, NOW), { ok: false, error: "already approved" });
  await assert.rejects(stat(files.proposals + ".lock"));
});

test("approve rules: add gets the next id, drop removes it; a gone rule or unknown kind fails and stays open", async () => {
  const files = await fixture();
  assert.equal((await decide("p-2-lead-gen", true, "", files, NOW)).ok, true);
  assert.equal((await decide("p-3-lead-gen", true, "", files, NOW)).ok, true);
  const plan = JSON.parse(await readFile(files.plan, "utf8"));
  assert.deepEqual(plan.bots["lead-gen"].rules, [{ id: "r2", text: "Check each one's own website" }, { id: "r3", text: "Skip chains and franchises" }]);
  const bad = await decide("p-4-the-ceo", true, "", files, NOW);
  assert.equal(bad.ok, false);
  assert.match((bad as { error: string }).error, /r7 is no longer/);
  assert.equal((await decide("p-5-lead-gen", true, "", files, NOW)).ok, false);
  const doc = JSON.parse(await readFile(files.proposals, "utf8"));
  assert.equal(doc.proposals[3].status, "open");
  assert.equal(doc.proposals[4].status, "open");
  assert.equal((await readFile(files.applied, "utf8")).trim().split("\n").length, 2);
});

test("decline: status and note saved, work plan and log untouched", async () => {
  const files = await fixture();
  const planBefore = await readFile(files.plan, "utf8");
  const r = await decide("p-2-lead-gen", false, "chains are fine for now", files, NOW);
  assert.equal(r.ok, true);
  assert.equal(await readFile(files.plan, "utf8"), planBefore);
  await assert.rejects(stat(files.applied));
  const rec = JSON.parse(await readFile(files.proposals, "utf8")).proposals[1];
  assert.equal(rec.status, "declined");
  assert.equal(rec.owner_note, "chains are fine for now");
});
