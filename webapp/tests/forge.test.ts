import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error TS5097
import { age, appendLine, decisionLines, foldForge, forgeBoard, readForge } from "../lib/forge.ts";

const W1 = { id: "w-20261112-101500-lead-gen", ts: "2026-11-12T10:15:00", bot: "lead-gen", for: "lead-gen", what: "a maps search action", why: "listings carry the no-site leads", key_result: "KR2 leads", status: "open" };
const W2 = { id: "w-20261112-111500-the-ceo", ts: "2026-11-12T11:15:00", bot: "the-ceo", for: "scout", what: "a feed reader", why: "", key_result: "", status: "open" };

test("fold: a wish line starts a wish, decision lines change it, newest last; junk and orphan decisions are skipped", () => {
  const text = [JSON.stringify(W1), "not json", JSON.stringify(W2), JSON.stringify({ id: W2.id, status: "later", decided_at: "2026-11-12T12:00:00", note: "after the launch", by: "owner" }),
    JSON.stringify({ id: "w-20261112-130000-nobody", status: "no" }), JSON.stringify({ id: W2.id, status: "open", ts: "2026-11-19T12:00:00", note: "asked again after 7 days" })].join("\n");
  const w = foldForge(text);
  assert.deepEqual(w.map((x: { id: string; status: string }) => [x.id, x.status]), [[W1.id, "open"], [W2.id, "open"]]);
  assert.equal(w[1].for, "scout");
  assert.equal(w[1].note, "asked again after 7 days");
  assert.equal(w[0].keyResult, "KR2 leads");
});

test("the board, the decision lines and Build's queue line; No needs a note; a decided wish is not decided again", () => {
  const now = new Date("2026-11-12T13:15:00");
  const [w1, w2] = foldForge([W1, W2].map((x) => JSON.stringify(x)).join("\n"));
  assert.deepEqual(forgeBoard([w1, w2], now).open.map((x: { id: string }) => x.id), [W1.id, W2.id]);
  assert.equal(age(W1.ts, now), "3 h");
  assert.equal(decisionLines(w1, "no", " ", now), "say why in a short note: the member reads it");
  assert.equal(decisionLines(w1, "done", "x", now), "the decision is build, later or no");
  assert.equal(decisionLines(undefined, "build", "", now), "no such wish");
  const b = decisionLines(w1, "build", "this week", now, "Lead Gen") as { line: string; queue: string };
  assert.deepEqual(JSON.parse(b.line), { id: W1.id, status: "build", decided_at: b.line.match(/"decided_at":"([^"]+)"/)![1], note: "this week", by: "owner" });
  assert.match(b.queue, /^- \d{4}-\d{2}-\d{2} Lead Gen: a maps search action -- listings carry the no-site leads \(KR2 leads\) \[wish w-20261112-101500-lead-gen\]: this week$/);
  assert.equal((decisionLines(w2, "later", "", now) as { queue: string | null }).queue, null);
  const built = foldForge([JSON.stringify(W1), b.line].join("\n"))[0];
  assert.equal(decisionLines(built, "no", "x", now), "this wish is already building");
});

test("appendLine writes whole lines that read back folded", async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "forge-")), "forge.jsonl");
  await appendLine(file, JSON.stringify(W1));
  await appendLine(file, JSON.stringify({ id: W1.id, status: "no", decided_at: "2026-11-12T13:00:00", note: "not now", by: "owner" }));
  assert.equal((await readFile(file, "utf8")).split("\n").length, 3);
  assert.deepEqual((await readForge(file)).map((x: { status: string; by: string }) => [x.status, x.by]), [["no", "owner"]]);
  await assert.rejects(appendLine(file, "x".repeat(5000)), /too long/);
});
