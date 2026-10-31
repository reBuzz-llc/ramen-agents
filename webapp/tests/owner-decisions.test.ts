// Run: npm test. The owner's decisions (2026-10-31): shared-state/owner-decisions.json answered from
// the dashboard: the lists the box renders, choose, done, later with its wake time, the note, and the log line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-ignore TS5097
import { decide, parseItems, partition } from "../lib/owner-decisions.ts";

const NOW = new Date(2026, 9, 31, 10, 0, 0).getTime();
const doc = () => ({
  version: 1,
  items: [
    { id: "d-clean", since: "2026-10-31", text: "Clean-up: remove the list?", options: ["Remove as recommended", "Keep everything"], link: { label: "Read the inventory", href: "/settings/reports" }, status: "open", extra: "kept" },
    { id: "d-mac", since: "2026-10-29", text: "Mac set to never sleep?", options: ["Done: set to never sleep"], status: "open" },
    { id: "d-okr", since: "2026-10-29", text: "Approve the OKR?", options: ["Approve as written"], status: "open" },
    { id: "d-old", since: "2026-09-01", text: "Old one", options: [], status: "decided", choice: "x", decided_at: "2026-09-02T09:00:00" },
    { id: "d-later", since: "2026-10-28", text: "Snoozed", options: [], status: "later", wake: "2026-11-02T09:00:00" },
    { id: "d-woke", since: "2026-10-27", text: "Woke up", options: [], status: "later", wake: "2026-10-31T09:00:00" },
    { id: 7, text: "malformed" },
  ],
});

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "decisions-"));
  const files = { items: path.join(dir, "owner-decisions.json"), log: path.join(dir, "owner-decisions-log.jsonl") };
  await writeFile(files.items, JSON.stringify(doc()));
  return files;
}

test("decisions: what the box renders: open items (a later one again once awake), decided in the last 30 days", () => {
  const items = parseItems(JSON.stringify(doc()));
  assert.equal(items.length, 6, "the malformed item is left out");
  const { open, decided } = partition(items, NOW);
  assert.deepEqual(open.map((d: { id: string }) => d.id), ["d-clean", "d-mac", "d-okr", "d-woke"]);
  assert.deepEqual(open[0].options, ["Remove as recommended", "Keep everything"]);
  assert.deepEqual(open[0].link, { label: "Read the inventory", href: "/settings/reports" });
  assert.deepEqual(decided, [], "a decision from September is past the 30 days");
  assert.deepEqual(parseItems("not json"), []);
});

test("decisions: choose an option, with a note; the log gets the record; a second answer is refused", async () => {
  const files = await fixture();
  const r = await decide("d-clean", { kind: "choose", choice: "Remove as recommended" }, "  but keep the CSVs  ", { files, now: NOW });
  assert.ok(r.ok);
  const saved = JSON.parse(await readFile(files.items, "utf8"));
  const it = saved.items[0];
  assert.deepEqual([it.status, it.choice, it.note, it.decided_at, it.extra], ["decided", "Remove as recommended", "but keep the CSVs", "2026-10-31T10:00:00", "kept"]);
  assert.equal(saved.items.length, 7, "the malformed item is kept in the file");
  const log = (await readFile(files.log, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(log, [{ id: "d-clean", status: "decided", choice: "Remove as recommended", note: "but keep the CSVs", decided_at: "2026-10-31T10:00:00", text: "Clean-up: remove the list?" }]);
  const { open, decided } = partition(parseItems(JSON.stringify(saved)), NOW);
  assert.ok(!open.some((d: { id: string }) => d.id === "d-clean"), "a decided item leaves the box");
  assert.equal(decided[0].id, "d-clean", "and shows under Show decided");
  const again = await decide("d-clean", { kind: "done" }, "", { files, now: NOW });
  assert.deepEqual(again, { ok: false, error: "already answered" });
  assert.deepEqual(await decide("d-mac", { kind: "choose", choice: "Something else" }, "", { files, now: NOW }), { ok: false, error: "not one of its options" });
  assert.deepEqual(await decide("nope", { kind: "done" }, "", { files, now: NOW }), { ok: false, error: "no such decision" });
});

test("decisions: Done; Later hides it for three days with a wake time, then it is back", async () => {
  const files = await fixture();
  assert.ok((await decide("d-mac", { kind: "done" }, "", { files, now: NOW })).ok);
  assert.ok((await decide("d-okr", { kind: "later" }, "after the weekend", { files, now: NOW })).ok);
  const saved = JSON.parse(await readFile(files.items, "utf8"));
  const okr = saved.items.find((d: { id: string }) => d.id === "d-okr");
  assert.deepEqual([okr.status, okr.wake, okr.note], ["later", "2026-11-03T10:00:00", "after the weekend"]);
  assert.equal(saved.items.find((d: { id: string }) => d.id === "d-mac").status, "done");
  const items = parseItems(JSON.stringify(saved));
  assert.ok(!partition(items, NOW).open.some((d: { id: string }) => d.id === "d-okr"), "hidden now");
  assert.ok(partition(items, NOW + 3 * 86400e3).open.some((d: { id: string }) => d.id === "d-okr"), "back after three days");
  const log = (await readFile(files.log, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(log.map((l: { id: string; status: string; wake?: string }) => [l.id, l.status, l.wake ?? ""]), [["d-mac", "done", ""], ["d-okr", "later", "2026-11-03T10:00:00"]]);
  // Later, then an answer once it is back: the wake time goes
  assert.ok((await decide("d-okr", { kind: "choose", choice: "Approve as written" }, "", { files, now: NOW + 4 * 86400e3 })).ok);
  const after = JSON.parse(await readFile(files.items, "utf8")).items.find((d: { id: string }) => d.id === "d-okr");
  assert.deepEqual([after.status, after.wake], ["decided", undefined]);
});
