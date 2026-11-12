// Run: npm test. "Seen" on the health banner (creatorCC queue 54): a seen line stays hidden until its fact changes;
// the reboot line says what it was when a panic report exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-ignore TS5097
import { factId, markSeen, parseSeen, readSeen, unseen } from "../lib/health-seen.ts";
// @ts-ignore TS5097
import { panicFor, rebootIssue } from "../lib/health.ts";

const reboot = { key: "reboot", since: "2026-10-31T14:07:00", text: "The Mac went off without a clean shutdown at 10-31 14:07 and came back at 10-31 14:08." };
const idle = { key: "idle:Scout", since: "2026-10-31T09:00:00", text: "Scout has had no accepted action since 09:00 (3 h 0 min awake, not resting)." };

test("seen hides a line; a changed fact (a new time or another bot) returns; the words alone do not matter", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "seen-"));
  const file = path.join(dir, "health-seen.json");
  assert.deepEqual(unseen([reboot, idle], await readSeen(file)).map((i: { key: string }) => i.key), ["reboot", "idle:Scout"]);
  await markSeen({ id: factId(reboot), text: reboot.text, file, now: new Date(2026, 9, 31, 15, 41).getTime() });
  const seen = await readSeen(file);
  assert.deepEqual(unseen([reboot, idle], seen).map((i: { key: string }) => i.key), ["idle:Scout"], "hidden once seen");
  assert.equal(seen[factId(reboot)].seen_at, "2026-10-31T15:41:00");
  assert.equal(unseen([{ ...reboot, text: "reworded" }], seen).length, 0, "the same fact in other words stays hidden");
  assert.equal(unseen([{ ...reboot, since: "2026-11-01T03:12:00" }], seen).length, 1, "a new reboot returns");
  assert.equal(unseen([{ ...idle, key: "idle:Lead Gen" }], parseSeen(JSON.stringify({ [factId(idle)]: { text: "", seen_at: "2026-10-31T15:00:00" } }))).length, 1, "another idle bot returns");
  assert.deepEqual(parseSeen("not json"), {});
});

test("the lock: two writers at once both land; a stale lock is broken; old entries are dropped", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "seen-"));
  const file = path.join(dir, "health-seen.json");
  await Promise.all([markSeen({ id: factId(reboot), text: "a", file }), markSeen({ id: factId(idle), text: "b", file })]);
  assert.equal(Object.keys(JSON.parse(await readFile(file, "utf8"))).length, 2, "neither write lost");
  await assert.rejects(stat(`${file}.lock`), "the lock is released");
  // a lock left behind by a crashed writer, 40 s old: broken, the write goes through
  await mkdir(`${file}.lock`);
  const old = new Date(Date.now() - 40_000);
  await utimes(`${file}.lock`, old, old);
  await markSeen({ id: factId({ key: "provider", since: "x" }), text: "c", file });
  assert.equal(Object.keys(await readSeen(file)).length, 3);
  // seen over 30 days ago: dropped on the next write
  await markSeen({ id: factId({ key: "later", since: "y" }), text: "d", file, now: Date.now() + 31 * 86400e3 });
  assert.deepEqual(Object.keys(await readSeen(file)), [factId({ key: "later", since: "y" })]);
});

test("the reboot line says what it was when a panic report of those minutes exists", () => {
  const off = [{ from: "2026-10-31T14:07:00", to: "2026-10-31T14:08:00", note: "no clean shutdown logged" }];
  const panics = [{ name: "panic-full-2026-10-31-140828.0002.panic", gpu: true }, { name: "panic-full-2026-10-29-190500.panic", gpu: false }];
  assert.equal(panicFor(panics, off[0].from, off[0].to)?.name, "panic-full-2026-10-31-140828.0002.panic");
  assert.equal(panicFor(panics, "2026-10-30T10:00:00", "2026-10-30T10:01:00"), null);
  assert.equal(rebootIssue(off, panics)?.text, "The Mac went off without a clean shutdown at 10-31 14:07 and came back at 10-31 14:08 (a kernel panic in the GPU memory driver; the bots restarted on their own).");
  assert.equal(rebootIssue(off, [])?.text, "The Mac went off without a clean shutdown at 10-31 14:07 and came back at 10-31 14:08.");
  assert.equal(rebootIssue(off, panics)?.since, "2026-10-31T14:07:00", "the same fact id with or without the clause");
});
