// Run: npm test. A member's dialogue opens with four lines: output and goal, the item it is on, provider and freshness,
// the last 30 minutes' allowed actions.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore TS5097
import { subjectOf } from "../lib/board.ts";
// @ts-ignore TS5097
import { nowLines } from "../lib/world.ts";

test("the item a write names", () => {
  assert.equal(subjectOf("update_lead", JSON.stringify({ name: "Sunrise Bakery", draft_email: "Hi…", email: null })), "Sunrise Bakery · Draft email");
  assert.equal(subjectOf("provider", JSON.stringify({ name: "Example AI" })), "Example AI");
  assert.equal(subjectOf("message", JSON.stringify({ to: "The CEO", text: "Done." })), "to The CEO: Done.");
  assert.equal(subjectOf("update_lead", "not json"), "");
});

const card = {
  slug: "outreach-writer",
  state: { word: "working", tone: "good", why: "" },
  last: { ts: "", words: "opened example.com", ago: "1 min ago", screen: { kind: "web", domain: "example.com", title: "Example" } },
  output: { label: "draft", today: 7 },
  actionsToday: 20,
  refusedShare: 0.25,
  item: "Sunrise Bakery · Draft email",
  modelAgo: "2 min ago",
  window: { allowed: 9, total: 15 },
  goal: 10,
  model: { label: "api.z.ai/glm-4.5-flash", ts: "" },
  questions: [],
};

test("the four lines, data-true", () => {
  assert.deepEqual(nowLines(card as never), { word: "working", lines: ["7/10 drafts", "Sunrise Bakery · Draft email", "z.ai · 2m", "9/15 ok · 30m"], refused: 0.25 });
  // no item: its page; no goal: no goal; no actions in the window: says so
  assert.deepEqual(nowLines({ ...card, item: "", goal: null, window: { allowed: 0, total: 0 } } as never).lines, ["7 drafts today", "example.com · Example", "z.ai · 2m", "no actions · 30m"]);
  // resting: until when and why
  assert.equal(nowLines({ ...card, state: { word: "resting until 14:40", tone: "muted", why: "work list empty" } } as never).lines[1], "until 14:40 · work list empty");
});

test("a desk's big screen: the name, a badge only when not working, the four lines, the square for a page", async () => {
  // @ts-ignore TS5097
  const { deskScreen } = await import("../lib/world.ts");
  const s = deskScreen({ ...card, name: "Outreach Writer", item: "" } as never);
  assert.deepEqual([s.name, s.word, s.mark, s.lines[1], s.share], ["Outreach Writer", "working", "web", "example.com · Example", 0.25]);
  assert.equal(deskScreen({ ...card, name: "W" } as never).mark, ""); // an item: no square
  const rest = deskScreen({ ...card, name: "W", state: { word: "resting until 14:40", tone: "muted", why: "work list empty" } } as never);
  assert.deepEqual([rest.word, rest.mode, rest.lines[1]], ["resting", "dark", "until 14:40 · work list empty"]);
});

test("the last model call comes from the newest trace, not the log's switch line", async () => {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  // @ts-ignore TS5097
  const { lastTraceModel } = await import("../lib/board.ts");
  const ws = await mkdtemp(path.join(tmpdir(), "trace-"));
  assert.equal(await lastTraceModel(ws), null);
  await mkdir(path.join(ws, "traces", "2026-01-06"), { recursive: true });
  await writeFile(path.join(ws, "traces", "2026-01-06", "120000-5-open.json"), JSON.stringify({ model: "api.z.ai/glm-4.5-flash", at: "2026-01-06T12:00:00" }));
  await writeFile(path.join(ws, "traces", "2026-01-06", "130500-6-search.json"), JSON.stringify({ model: "gemini/flash" }));
  assert.deepEqual(await lastTraceModel(ws), { label: "gemini/flash", ts: "2026-01-06T13:05:00" });
});

test("a desk's HTML screen box by its width: full from 120 px, compact from 80 px, tiny below", async () => {
  // @ts-ignore TS5097
  const { screenForm } = await import("../lib/world.ts");
  assert.deepEqual(screenForm(155, 110), { form: "full", lines: 4 });
  assert.deepEqual(screenForm(95, 68), { form: "compact", lines: 3 });
  assert.deepEqual(screenForm(57, 43), { form: "tiny", lines: 2 });
});
