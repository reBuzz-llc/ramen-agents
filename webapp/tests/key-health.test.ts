import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error TS5097
import { healthLine } from "../lib/key-health.ts";

test("the ledger's health: failing since the last answer is not working; a spent allowance is limited; answering is nothing", () => {
  const day = "2026-11-12";
  assert.deepEqual(healthLine({ last_ok: "2026-11-12T17:51:08", last_fail: "2026-11-12T17:53:47", first_fail: "2026-11-12T17:51:42", last_reason: "empty reply" }, day),
    { state: "not working", note: "Not answering since 17:51 (empty reply)" });
  assert.equal(healthLine({ last_ok: "2026-11-12T18:00:00", last_fail: "2026-11-12T17:53:47" }, day), null);
  assert.deepEqual(healthLine({ spent: "2026-11-12", last_ok: "2026-11-12T18:00:00" }, day), { state: "limited", note: "Allowance spent today: back at midnight" });
  assert.deepEqual(healthLine({ spent: "2026-11" }, day)?.state, "limited");
  assert.equal(healthLine({ spent: "2026-11-11" }, day), null);
  assert.equal(healthLine(undefined, day), null);
  // the page's own test after the bots' last failure (Gonka, 11-12): passed is ready with both times; failed says why
  const h = { last_ok: "2026-11-12T15:00:00", last_fail: "2026-11-12T16:06:10", first_fail: "2026-11-12T16:06:10", last_reason: "empty reply" };
  assert.deepEqual(healthLine(h, day, { at: "2026-11-12T18:20:00", ok: true, level: "works", message: "Key works" }),
    { state: "ready", note: "Test passed at 18:20; the bots' last call failed at 16:06 (empty reply) and clears on their next good one" });
  assert.equal(healthLine(h, day, { at: "2026-11-12T16:00:00", ok: true, level: "works", message: "Key works" })?.state, "not working");
  assert.match(healthLine(h, day, { at: "2026-11-12T18:20:00", ok: false, level: "rejected", message: "Key rejected (401)" })!.note, /test at 18:20: Key rejected \(401\)/);
});
