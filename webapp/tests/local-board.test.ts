// The local board (queue 572): the hosted portal's rules on one SQLite file, so the engine and the Validator read and
// write it as they would the portal.
import assert from "node:assert/strict";
import { test } from "node:test";
process.env.LOCAL_BOARD_FILE = ":memory:";
// @ts-expect-error TS5097
import { adoptToken, allRows, closeBoard, getRow, handOverPackage, issueToken, listRows, reviewPackage, rowHistory, tokenName, writeRow } from "../lib/local-board.ts";

const bot = { kind: "bot" as const, name: "lead-gen" };
const person = { kind: "person" as const, name: "Sam Example" };
const fresh = () => closeBoard();

test("a lead: created by an agent, the team's cells refused to it, domain and city worked out", () => {
  fresh();
  const r = writeRow("leads", {}, { business: "Cobalt Bakery", website: "https://www.cobalt-bakery.example/menu", location: "Brooklyn, NY 11201", status: ["Email Sent"], pain_point: "no menu online" }, bot, { create: true });
  assert.ok(r.ok && r.created);
  if (!r.ok) return;
  assert.deepEqual(r.refused.map((x) => [x.field, x.reason]), [["status", "human_only"]]);
  assert.equal(r.row.domain, "cobalt-bakery.example");
  assert.equal(r.row.city, "Brooklyn");
  assert.equal(r.row.state, "NY");
  assert.equal(r.row.status, undefined);
});

test("one lead per business: the same domain, or with no website the same name, is a duplicate_row with its id", () => {
  fresh();
  const a = writeRow("leads", {}, { business: "Cobalt Bakery", website: "cobalt-bakery.example" }, bot, { create: true });
  const b = writeRow("leads", {}, { business: "Cobalt Bakehouse", website: "https://cobalt-bakery.example/about" }, bot, { create: true });
  assert.ok(a.ok);
  assert.ok(!b.ok && b.code === "duplicate_row" && b.existingId === (a.ok ? a.row.id : ""));
  writeRow("leads", {}, { business: "Harbor Tailors" }, bot, { create: true });
  const c = writeRow("leads", {}, { business: "harbor tailors " }, bot, { create: true });
  assert.ok(!c.ok && c.code === "duplicate_row");
});

test("a person's cell wins over an agent's write; fill_only leaves a filled cell; derived cells are refused", () => {
  fresh();
  const a = writeRow("leads", {}, { business: "Cobalt Bakery", industry: "Bakery" }, bot, { create: true });
  assert.ok(a.ok);
  if (!a.ok) return;
  const id = a.row.id;
  assert.ok(writeRow("leads", { id }, { industry: "Café" }, person).ok);
  const r = writeRow("leads", { id }, { industry: "Bakery", size: "2-10", domain: "x.example" }, bot);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.written, ["size"]);
  assert.deepEqual(r.refused.map((x) => [x.field, x.reason]), [["industry", "person_wins"], ["domain", "derived"]]);
  const f = writeRow("leads", { id }, { size: "11-50", pain_point: "slow site" }, bot, { fillOnly: true });
  assert.ok(f.ok && f.written.join() === "pain_point" && f.refused[0].reason === "filled");
  // every applied and refused cell is kept
  assert.ok(rowHistory(id).some((h: { field: string; outcome: string; reason: string | null }) => h.field === "industry" && h.outcome === "refused" && h.reason === "person_wins"));
});

test("unknown fields and bad values are refused before anything is written", () => {
  fresh();
  assert.deepEqual(writeRow("leads", {}, { business: "X", favourite_colour: "blue" }, bot, { create: true }), { ok: false, code: "bad_request", message: "unknown field: favourite_colour" });
  const r = writeRow("leads", {}, { business: "X", lead_score: "high" }, bot, { create: true });
  assert.ok(!r.ok && r.code === "bad_request");
  assert.deepEqual(allRows("leads"), []);
  assert.ok(!writeRow("leads", { id: "nope" }, { industry: "x" }, bot).ok);
});

test("the Validator alone may clear a WhatsApp number the team marked false", () => {
  fresh();
  const a = writeRow("leads", {}, { business: "Cobalt Bakery" }, bot, { create: true });
  if (!a.ok) return assert.fail();
  writeRow("leads", { id: a.row.id }, { whatsapp_status: "False Whatsapp Number" }, person);
  const other = writeRow("leads", { id: a.row.id }, { whatsapp_status: null }, bot);
  assert.ok(other.ok && other.refused[0].reason === "human_only");
  const v = writeRow("leads", { id: a.row.id }, { whatsapp_status: null }, { kind: "bot", name: "validator", validator: true });
  assert.ok(v.ok && v.written.join() === "whatsapp_status");
});

test("reads since a revision: only what changed, in order, with more/next; a later read carries archives", () => {
  fresh();
  for (const n of ["A", "B", "C"]) writeRow("leads", {}, { business: `Shop ${n}` }, bot, { create: true });
  const first = listRows("leads", { since: 0, limit: 2 });
  assert.equal(first.rows.length, 2);
  assert.equal(first.more, true);
  const rest = listRows("leads", { since: first.next, limit: 2 });
  assert.deepEqual(rest.rows.map((r) => r.business), ["Shop C"]);
  assert.equal(rest.more, false);
  assert.deepEqual(listRows("leads", { since: rest.next }).rows, []);
  const id = first.rows[0].id;
  writeRow("leads", { id }, {}, person, { archive: true });
  const after = listRows("leads", { since: rest.next });
  assert.equal(after.rows.length, 1);
  assert.equal(after.rows[0].archived, true);
  assert.equal(listRows("leads", { since: 0 }).rows.length, 2); // a first read leaves it out
});

test("keys: issued once, stored hashed, known by name; a key file's value is adopted", () => {
  fresh();
  const t = issueToken("portal-engine");
  assert.equal(tokenName(t), "portal-engine");
  assert.equal(tokenName("not-a-key"), null);
  adoptToken("portal-validator", "a-value-from-a-key-file-0123");
  assert.equal(tokenName("a-value-from-a-key-file-0123"), "portal-validator");
});

test("tasks: an agent's starts Not started; its status, assignees and checklist are the team's", () => {
  fresh();
  const t = writeRow("tasks", {}, { title: "Call three bakeries", priority: "High", status: "Done", assignees: ["Sam"] }, { kind: "bot", name: "the-ceo" }, { create: true });
  assert.ok(t.ok);
  if (!t.ok) return;
  assert.equal(t.row.status, "Not started");
  assert.deepEqual(t.refused.map((x) => x.field).sort(), ["assignees", "status"]);
  const p = writeRow("tasks", { id: t.row.id }, { status: "Done" }, person);
  assert.ok(p.ok && p.row.status === "Done");
  assert.equal(getRow(t.row.id)?.board, "tasks");
});

test("packages: an agent's draft is updated in place, never published by it; a review is stamped on it", () => {
  fresh();
  const a = handOverPackage({ name: "Starter Website", price: "$500", buyer: "a bakery", deliverables: "one page", by: "package-designer" }, { kind: "bot", name: "package-designer" });
  assert.ok(a.ok && a.created && a.row.status === "draft");
  const b = handOverPackage({ name: "starter website", price: "$600", by: "package-designer" }, { kind: "bot", name: "package-designer" });
  assert.ok(b.ok && !b.created && b.row.price === "$600");
  if (!a.ok) return;
  writeRow("packages", { id: a.row.id }, { status: "published" }, person);
  const c = handOverPackage({ name: "Starter Website", price: "$1", by: "package-designer" }, { kind: "bot", name: "package-designer" });
  assert.ok(c.ok && c.created); // the published one is left alone: a new draft
  const r = reviewPackage({ name: "Starter Website", verdict: "revise", note: "price too low", by: "the-ceo" }, { kind: "bot", name: "the-ceo" });
  assert.ok(r.ok);
  assert.ok(!reviewPackage({ name: "Nothing", verdict: "approve" }, { kind: "bot", name: "the-ceo" }).ok);
  closeBoard();
});
