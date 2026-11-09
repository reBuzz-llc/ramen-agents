// The Checks page's rules: how a verdict counts, the plain-language reasons, the change markers and
// The CEO's tasks done by a person on the team portal.
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error TS5097
import { doneByPerson, engineMarkers, kindOf, reasonLabel, restartMarkers, weekIndex } from "../lib/checks.ts";

test("robots is fence; held and failed are their own; a closed site apart; the rest refused", () => {
  assert.equal(kindOf("allowed"), "allowed");
  assert.equal(kindOf("rejected: that site asks bots not to read it; it stays closed today: take another source"), "fence");
  assert.equal(kindOf("rejected: robots.txt disallows /"), "fence");
  assert.equal(kindOf("held: the owner's packages page shows old prices: republish X"), "held");
  assert.equal(kindOf("failed: 'Cobot' already has a draft; it is done unless the Validator asks for a fix"), "failed");
  assert.equal(kindOf("rejected: data.cityofnewyork.us shows us a captcha or no text, so the whole site is closed today"), "closed");
  assert.equal(kindOf("rejected: you searched that today; the answer did not change"), "refused");
  assert.equal(kindOf("rejected: a personal mailbox is never the business's address"), "fence");
});

test("reasons in plain words; a Validator rule by its code; an unknown one tidied", () => {
  assert.equal(reasonLabel("failed: 'Cobot' already has a draft; it is done unless the Validator asks for a fix"), "Tried a row that's already drafted");
  assert.equal(reasonLabel("rejected: you searched that today; the answer did not change. Open a result"), "Searched the same thing again");
  assert.equal(reasonLabel("rejected: that was refused or done already today; it stays blocked until tomorrow"), "Tried again what was refused or done today");
  assert.equal(reasonLabel("held: the owner's packages page shows old prices: republish NYC Launchpad"), "Waiting for the owner to republish prices");
  assert.equal(reasonLabel("rejected: Validator rules: OWN: the Outreach Writer only fills the Draft email"), "Broke the Validator's rule OWN");
  assert.equal(reasonLabel("failed: 'Shop 12' already has Location"), "Filled a cell that's already filled");
  assert.equal(reasonLabel("rejected: That is the note you already have as 'x'"), "Wrote a note that already exists");
  assert.equal(reasonLabel("rejected: 'x' is already in the report"), "Reported something already in the report");
  assert.equal(reasonLabel("rejected: something new about 'Shop 12' happened 3 times; more"), "Something new about '…' happened N times");
});

test("markers: the engine's commits for every bot, each bot's last restart for that bot", () => {
  const e = engineMarkers("2026-11-09T17:24:29+05:45|930e754|A WhatsApp-only row gets the owner's message\nnot a line\n");
  assert.deepEqual(e, [{ at: "2026-11-09T17:24:29", by: "engine", bots: ["*"], kind: "engine", what: "930e754 A WhatsApp-only row gets the owner's message" }]);
  const r = restartMarkers({ fleet: [{ slug: "the-ceo", name: "The CEO", started: "2026-11-09T14:32:41" }, { slug: "x", started: "" }] });
  assert.deepEqual(r, [{ at: "2026-11-09T14:32:41", by: "restart", bots: ["the-ceo"], kind: "restart", what: "The CEO restarted" }]);
  assert.deepEqual(restartMarkers(null), []);
});

test("a task counts when a person moved it to Done, in that step's week", () => {
  const h = [
    { column: "status", new: "Done", actor: { kind: "bot" }, at: "2026-11-08T10:00:00Z", outcome: "applied" },
    { column: "status", new: "Done", actor: { kind: "person" }, at: "2026-11-05T10:00:00Z", outcome: "applied" },
    { column: "status", new: "Done", actor: { kind: "person" }, at: "2026-11-06T10:00:00Z", outcome: "refused" },
  ];
  assert.equal(doneByPerson(h), "2026-11-05T10:00:00Z");
  assert.equal(doneByPerson([{ column: "status", new: "Done", actor: { kind: "bot" }, at: "2026-11-08T10:00:00Z" }]), null);
  const now = Date.parse("2026-11-09T12:00:00Z");
  assert.equal(weekIndex("2026-11-05T10:00:00Z", now), 0);
  assert.equal(weekIndex("2026-11-01T10:00:00Z", now), 1);
  assert.equal(weekIndex("2026-09-01T10:00:00Z", now), -1);
  assert.equal(weekIndex("2026-11-10T10:00:00Z", now), -1);
});

test("the verdict line: this week against last, agents under target, the worst above it", async () => {
  // @ts-expect-error TS5097
  const { deltaOf, rateOf, verdictOf } = await import("../lib/checks.ts");
  assert.equal(rateOf({ allowed: 80, refused: 20 }), 20);
  assert.equal(rateOf({ allowed: 0, refused: 0 }), null);
  assert.deepEqual(deltaOf({ allowed: 70, refused: 30 }, { allowed: 80, refused: 20 }), { arrow: "↑", points: 10 });
  assert.equal(deltaOf({ allowed: 1, refused: 0 }, { allowed: 0, refused: 0 }), null);
  const v = verdictOf([
    { name: "A", week: { allowed: 90, refused: 10 }, prevWeek: { allowed: 80, refused: 20 } },
    { name: "B", week: { allowed: 50, refused: 50 }, prevWeek: { allowed: 60, refused: 40 } },
    { name: "C", week: { allowed: 0, refused: 0 }, prevWeek: { allowed: 0, refused: 0 } },
  ]);
  assert.equal(v.text, "The family refused 30% of its actions this week (same as last week); 1 of 2 agents under the 20% target.");
  assert.deepEqual(v.worst, { name: "B", rate: 50 });
  assert.equal(verdictOf([]).text, "No actions in the last seven days.");
});
