// The owner's open items in the Decisions box (creatorCC queue 401): the read and the Done write.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error TS5097
import { markItemDone, ownerItems, parseOwnerItems } from "../lib/owner-items.ts";

const doc = () => ({
  items: [
    { id: "o-a", ts: "2026-11-10T01:58", title: "Decide the  q3 trial", how: "click Yes or No", status: "open", extra: "kept" },
    { id: "o-b", ts: "2026-11-09T22:00", title: "Cloudflare token", how: "save the key", status: "open" },
    { id: "o-c", ts: "2026-11-01T10:00", title: "Old", how: "", status: "done", done_ts: "2026-11-02T09:00:00" },
    { id: "o-d", title: "No status reads as open" },
    { id: 7, title: "malformed" },
    { id: "o-e", how: "no title" },
  ],
});

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "owner-items-"));
  const file = path.join(dir, "owner-items.json");
  await writeFile(file, JSON.stringify(doc()));
  return file;
}

test("the read: open items in order, done and malformed left out, whitespace tidied", async () => {
  const items = parseOwnerItems(JSON.stringify(doc()));
  assert.deepEqual(items.map((i: { id: string }) => i.id), ["o-a", "o-b", "o-d"]);
  assert.deepEqual(items[0], { id: "o-a", ts: "2026-11-10T01:58", title: "Decide the q3 trial", how: "click Yes or No" });
  assert.equal(items[2].how, "");
  assert.deepEqual(parseOwnerItems("not json"), []);
  assert.deepEqual(parseOwnerItems('{"items":3}'), []);
  assert.deepEqual(await ownerItems(path.join(tmpdir(), "no-such-owner-items.json")), []);
});

test("Done: status done and done_ts in the file, other fields kept, the item leaves the list", async () => {
  const file = await fixture();
  const now = new Date(2026, 10, 10, 9, 5, 7).getTime();
  assert.deepEqual(await markItemDone("o-a", { file, now }), { ok: true });
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(saved.items[0], { id: "o-a", ts: "2026-11-10T01:58", title: "Decide the  q3 trial", how: "click Yes or No", status: "done", extra: "kept", done_ts: "2026-11-10T09:05:07" });
  assert.equal(saved.items.length, 6);
  assert.deepEqual((await ownerItems(file)).map((i: { id: string }) => i.id), ["o-b", "o-d"]);
  assert.deepEqual(await markItemDone("o-a", { file, now }), { ok: false, error: "already done" });
  assert.deepEqual(await markItemDone("nope", { file, now }), { ok: false, error: "no such item" });
  await assert.rejects(stat(`${file}.lock`)); // the lock is released
});

test("Done waits for a fresh lock and breaks a stale one", async () => {
  const file = await fixture();
  await mkdir(`${file}.lock`);
  const { utimes } = await import("node:fs/promises");
  const old = new Date(Date.now() - 60_000);
  await utimes(`${file}.lock`, old, old);
  assert.deepEqual(await markItemDone("o-b", { file }), { ok: true });
  assert.equal(JSON.parse(await readFile(file, "utf8")).items[1].status, "done");
});

test("Done on a missing file says so", async () => {
  assert.deepEqual(await markItemDone("o-a", { file: path.join(tmpdir(), `none-${Date.now()}`, "owner-items.json") }), { ok: false, error: "the owner items file is missing or not JSON" });
});
