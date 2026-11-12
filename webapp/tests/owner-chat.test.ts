// Run: npm test. The owner's private chat with one agent (queue 34, 2026-10-31): the chat file read with a torn last
// line, the owner's post (one jsonl line and an inbox file in the bots' message shape), and the text rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-ignore TS5097
import { cleanText, parseChat, postChat, readChat } from "../lib/owner-chat.ts";

test("chat: lines oldest first, a torn last line skipped, a malformed one too, the last `limit` kept", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "chat-"));
  const file = path.join(dir, "lead-gen.jsonl");
  await writeFile(
    file,
    [
      JSON.stringify({ ts: "2026-10-31T10:00:00", from: "Owner", text: "How many leads today?" }),
      JSON.stringify({ ts: "2026-10-31T10:04:12", from: "Lead Gen", text: "Seven so far, two without email." }),
      JSON.stringify({ ts: "2026-10-31T10:05:00", from: "Owner" }),
      '{"ts": "2026-10-31T10:06:00", "from": "Lead G',
    ].join("\n"),
  );
  assert.deepEqual((await readChat(file)).map((l: { from: string }) => l.from), ["Owner", "Lead Gen"]);
  assert.deepEqual(parseChat(await readFile(file, "utf8"), 1), [{ ts: "2026-10-31T10:04:12", from: "Lead Gen", text: "Seven so far, two without email." }]);
  assert.deepEqual(await readChat(path.join(dir, "none.jsonl")), []);
});

test("chat: the owner's post is one jsonl line and an inbox message in the bots' shape, written whole", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "chat-post-"));
  const chatFile = path.join(dir, "owner-chat", "lead-gen.jsonl");
  const ws = path.join(dir, "lead-gen", "workspace");
  const now = new Date(2026, 9, 31, 11, 20, 5).getTime();
  const a = await postChat({ chatFile, ws, text: "Skip chains today, please.", now });
  const b = await postChat({ chatFile, ws, text: "And note the florists.", now });
  assert.deepEqual(a.line, { ts: "2026-10-31T11:20:05", from: "Owner", text: "Skip chains today, please." });
  const lines = (await readFile(chatFile, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l: { text: string }) => l.text), ["Skip chains today, please.", "And note the florists."]);
  const inbox = (await readdir(path.join(ws, "inbox"))).sort();
  assert.deepEqual(inbox, ["2026-10-31-112005-owner-2.json", "2026-10-31-112005-owner.json"], "two in one second both kept; no temp file left");
  assert.equal(path.basename(b.inbox), "2026-10-31-112005-owner-2.json");
  assert.deepEqual(JSON.parse(await readFile(a.inbox, "utf8")), { from: "Owner", kind: "message", sent_at: "2026-10-31T11:20:05", text: "Skip chains today, please." });
});

test("chat: the text rules: trimmed, newlines become spaces, empty or past 500 characters refused", () => {
  assert.equal(cleanText("  Hello\n  there\r\nfriend  "), "Hello there friend");
  assert.equal(cleanText("   \n "), null);
  assert.equal(cleanText(""), null);
  assert.equal(cleanText(42), null);
  assert.equal(cleanText("x".repeat(500)), "x".repeat(500));
  assert.equal(cleanText("x".repeat(501)), null);
});

test("unread replies (queue 35): the agent's last line is unread until seen; seen clears it; none when the owner wrote last", async () => {
  // @ts-ignore TS5097
  const { unreadReplies } = await import("../lib/world.ts");
  // @ts-ignore TS5097
  const { latestReplies, lastReplyTs } = await import("../lib/owner-chat.ts");
  const dir = await mkdtemp(path.join(tmpdir(), "chat-unread-"));
  const line = (ts: string, from: string, text: string) => JSON.stringify({ ts, from, text });
  await writeFile(path.join(dir, "lead-gen.jsonl"), [line("2026-10-31T10:00:00", "Owner", "Any leads?"), line("2026-10-31T10:07:00", "Lead Gen", "Seven.")].join("\n") + "\n");
  await writeFile(path.join(dir, "the-ceo.jsonl"), [line("2026-10-31T09:00:00", "The CEO", "Done."), line("2026-10-31T09:30:00", "Owner", "Thanks.")].join("\n") + "\n");
  const replies = await latestReplies(dir, ["lead-gen", "the-ceo", "scout"]);
  assert.deepEqual(replies, { "lead-gen": "2026-10-31T10:07:00", "the-ceo": null, scout: null }, "no chat file: null; the owner wrote last: null");
  assert.deepEqual(unreadReplies(replies, {}), ["lead-gen"], "nothing remembered: the reply is unread");
  assert.deepEqual(unreadReplies(replies, { "lead-gen": "2026-10-31T10:07:00" }), [], "opening the tab marks it seen: cleared");
  assert.deepEqual(unreadReplies(replies, { "lead-gen": "2026-10-31T09:59:00" }), ["lead-gen"], "a newer reply than the one seen");
  assert.deepEqual(unreadReplies(undefined, {}), []);
  assert.equal(lastReplyTs([]), null);
});
