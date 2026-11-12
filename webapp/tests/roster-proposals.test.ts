// The CEO's roster proposals in the Decisions box (creatorCC queue 440 on valiCC's 439 design): the read, the decided
// list, Approve and Decline under the lock, the owner's start/stop path for start and stop, the roster applier for the
// rest, a create's edits; and the persona changes in the CEO changes list with their Undo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error TS5097
import { applyEdits, decideRoster, parseRoster, rosterBoard, rosterWords, statusWord } from "../lib/roster-proposals.ts";
// @ts-expect-error TS5097
import { parseProposals } from "../lib/ceo-proposals.ts";
// @ts-expect-error TS5097
import { CHANGED_SINCE, canUndo, parseChanges, personaSections, sideText, undo } from "../lib/ceo-changes.ts";
// @ts-expect-error TS5097
import { parseOwnerItems } from "../lib/owner-items.ts";
// @ts-expect-error TS5097
import { lookOf } from "../lib/world.ts";

const NOW = new Date(2026, 10, 11, 15, 0, 0).getTime();
const sheet = { member: { calls_yesterday: null, tokens_yesterday: 41200, estimate: false }, family: { allowance_pct_yesterday: 38 }, mac: { free_gb: 5.4, swap_used_gb: 1.2 }, after_pct: 44, line: "with this change the family sits at about 44% of its free allowance (yesterday 38%)" };
const roster = (id: string, bot: string, change: object, extra: object = {}) => ({ id, ts: "2026-11-11T14:20:00", bot, change: { kind: "roster", ...change }, reason: "more leads", goal_served: "KR1: 20 replies", resource_sheet: sheet, status: "open", ...extra });
const records = () => [
  roster("r-start", "scout", { action: "start" }),
  roster("r-stop", "lead-enricher", { action: "stop" }),
  roster("r-rename", "lead-gen", { action: "rename", new_name: "Pathfinder" }),
  roster("r-create", "site-checker", { action: "create", slug: "site-checker", name: "Site Checker", role: "checks lead sites", template: "reader", persona: { "Who you are": "You check sites.", "How you work": "One site a step." }, goal: "Check every new lead's site", rules: [{ text: "Never write to the board", by: "ceo" }], expected_calls_day: 120 }),
  roster("r-old", "scout", { action: "stop" }, { status: "declined", decided_at: "2026-11-01T10:00:00" }),
  roster("r-exp", "scout", { action: "start" }, { status: "expired", expired_at: "2026-11-11T09:00:00", expired_note: "seven days open" }),
  roster("r-done", "scout", { action: "stop" }, { status: "applied", decided_at: "2026-11-10T10:00:00", applied_at: "2026-11-10T10:01:00", apply_result: "STOP written." }),
  { id: "p-goal", ts: "2026-11-11T09:00:00", bot: "lead-gen", change: { kind: "goal", text: "x" }, status: "open" },
  { id: "c-persona", ts: "2026-11-11T12:00:00", bot: "scout", change: { kind: "persona", section: "How you work", text: "New way." }, field: "persona:How you work", before: "Old way.\n\n", after: "New way.\n\n", reason: "focus", status: "applied", applied_at: "2026-11-11T12:00:00", undo_until: "2026-11-18T12:00:00" },
];

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "roster-"));
  const proposals = path.join(dir, "ceo-proposals.json");
  await writeFile(proposals, JSON.stringify({ version: 1, proposals: records() }, null, 1));
  return { dir, proposals };
}
const read = async (f: string) => JSON.parse(await readFile(f, "utf8")).proposals as Record<string, unknown>[];
const rec = async (f: string, id: string) => (await read(f)).find((r) => r.id === id)!;

test("the read: roster records only, open oldest first, decided in 7 days newest first, expired among them", () => {
  const list = parseRoster(JSON.stringify({ proposals: records() }));
  const b = rosterBoard(list, NOW);
  assert.deepEqual(b.open.map((p: { id: string }) => p.id), ["r-start", "r-stop", "r-rename", "r-create"]);
  assert.deepEqual(b.decided.map((p: { id: string }) => p.id), ["r-exp", "r-done"]);
  const start = list[0];
  assert.equal(start.sheet.line.startsWith("with this change"), true);
  assert.deepEqual([start.sheet.tokensYesterday, start.sheet.callsYesterday, start.sheet.familyPct, start.sheet.afterPct, start.sheet.freeGb], [41200, null, 38, 44, 5.4]);
  const create = list.find((p: { id: string }) => p.id === "r-create")!;
  assert.deepEqual(create.create!.persona, [["Who you are", "You check sites."], ["How you work", "One site a step."]]);
  assert.deepEqual(create.create!.rules, ["Never write to the board"]);
  assert.equal(rosterWords(list[2], "Lead Gen"), "Rename Lead Gen to Pathfinder");
  assert.equal(rosterWords(create, "site-checker"), "Create Site Checker (reader)");
  assert.equal(statusWord(b.decided[0]), "Expired");
  // the step-one list and the CEO changes leave roster records out; the persona change is a CEO change
  assert.deepEqual(parseProposals(JSON.stringify({ proposals: records() })).map((p: { id: string }) => p.id), ["p-goal"]);
  assert.deepEqual(parseChanges(JSON.stringify({ proposals: records() })).map((c: { id: string }) => c.id), ["c-persona"]);
});

test("Decline: status, note and time in one write; nothing runs", async () => {
  const f = await fixture();
  const ran: string[] = [];
  const ap = { startStop: async () => (ran.push("ss"), { ok: true, text: "" }), roster: async () => (ran.push("r"), { ok: true, text: "" }) };
  const r = await decideRoster("r-start", false, "  not  now ", {}, ap, { proposals: f.proposals }, NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(ran, []);
  const x = await rec(f.proposals, "r-start");
  assert.deepEqual([x.status, x.owner_note, x.decided_at], ["declined", "not now", "2026-11-11T15:00:00"]);
  assert.deepEqual(await decideRoster("r-start", true, "", {}, ap, { proposals: f.proposals }, NOW), { ok: false, error: "already declined" });
  await assert.rejects(stat(`${f.proposals}.lock`));
});

test("Approve a start or stop: the owner's own path with the via, then applied or failed with its result line", async () => {
  const f = await fixture();
  const calls: unknown[] = [];
  const ap = {
    startStop: async (slug: string, action: string, via: string, note: string) => (calls.push([slug, action, via, note]), action === "start" ? { ok: true, text: "run loop alive" } : { ok: false, text: "disable-bot.sh failed" }),
    roster: async () => ({ ok: false, text: "should not run" }),
  };
  const a = await decideRoster("r-start", true, "go", {}, ap, { proposals: f.proposals }, NOW);
  assert.equal(a.ok && a.proposal.status, "applied");
  assert.deepEqual(calls[0], ["scout", "start", "approval in the Decisions box, proposal r-start", "go"]);
  const x = await rec(f.proposals, "r-start");
  assert.deepEqual([x.status, x.owner_note, x.decided_at, x.apply_result], ["applied", "go", "2026-11-11T15:00:00", "run loop alive"]);
  const b = await decideRoster("r-stop", true, "", {}, ap, { proposals: f.proposals }, NOW);
  assert.equal(b.ok && b.proposal.status, "failed");
  assert.equal((await rec(f.proposals, "r-stop")).apply_result, "disable-bot.sh failed");
});

test("Approve a rename: approved first, then the roster applier, which writes applied itself; if it cannot run, failed", async () => {
  const f = await fixture();
  let seen = "";
  const ap = {
    startStop: async () => ({ ok: false, text: "" }),
    roster: async (id: string) => {
      const doc = JSON.parse(await readFile(f.proposals, "utf8"));
      const r = doc.proposals.find((p: { id: string }) => p.id === id);
      seen = r.status; // the applier refuses anything not approved
      Object.assign(r, { status: "applied", applied_at: "2026-11-11T15:00:05", apply_result: "renamed; restart the running bots" });
      await writeFile(f.proposals, JSON.stringify(doc));
      return { ok: true, text: `${id}: applied: renamed; restart the running bots` };
    },
  };
  const r = await decideRoster("r-rename", true, "", {}, ap, { proposals: f.proposals }, NOW);
  assert.equal(seen, "approved");
  assert.equal(r.ok && r.proposal.status, "applied");
  assert.equal(r.ok && r.text, "r-rename: applied: renamed; restart the running bots");
  const broken = { startStop: ap.startStop, roster: async () => ({ ok: false, text: "python3: not found" }) };
  const f2 = await fixture();
  const b = await decideRoster("r-rename", true, "", {}, broken, { proposals: f2.proposals }, NOW);
  assert.equal(b.ok && b.proposal.status, "failed");
  assert.match(String((await rec(f2.proposals, "r-rename")).apply_result), /did not run: python3: not found/);
});

test("a create: the owner may edit name, goal and persona text before Approve; checked, and owner_edited says which", async () => {
  const change = { name: "Site Checker", goal: "Check sites", persona: { "Who you are": "You check sites." } };
  assert.equal(applyEdits(change, { name: "x" }), "a name is 2 to 40 letters, digits, spaces, & or -");
  assert.equal(applyEdits(change, { persona: { Elsewhere: "t" } }), 'the persona has no section "Elsewhere"');
  assert.equal(applyEdits(change, { persona: { "Who you are": "## Off limits\nall" } }), '"Who you are" cannot hold a heading of its own');
  assert.equal(applyEdits(change, { goal: "x".repeat(201) }), "keep the goal under 200 characters");
  const f = await fixture();
  let sawEdit: unknown = null;
  const ap = { startStop: async () => ({ ok: false, text: "" }), roster: async () => ((sawEdit = (await rec(f.proposals, "r-create")).change), { ok: true, text: "r-create: applied: scaffolded" }) };
  const r = await decideRoster("r-create", true, "", { name: "Site Checker", goal: "Check every new lead's site within a day", persona: { "How you work": "Two sites a step." } }, ap, { proposals: f.proposals }, NOW);
  assert.equal(r.ok, true);
  const x = await rec(f.proposals, "r-create");
  assert.deepEqual(x.owner_edited, ["goal", "persona:How you work"]);
  assert.equal((sawEdit as { goal: string }).goal, "Check every new lead's site within a day");
  assert.equal((x.change as { persona: Record<string, string> }).persona["How you work"], "Two sites a step.");
  assert.equal((x.change as { template: string }).template, "reader"); // role and template untouched
  // a bad edit: nothing is written, the proposal stays open
  const f2 = await fixture();
  assert.deepEqual(await decideRoster("r-create", true, "", { name: "!" }, ap, { proposals: f2.proposals }, NOW), { ok: false, error: "a name is 2 to 40 letters, digits, spaces, & or -" });
  assert.equal((await rec(f2.proposals, "r-create")).status, "open");
});

const PERSONA = "# Scout\n\nIntro.\n\n## Who you are\n\nYou scout.\n\n## How you work\n\nNew way.\n\n### Detail\n\nkept inside\n\n## Off limits\n\nNever pay.\n";

test("persona changes: the section's bounds, the line, and Undo writes before back under persona.md.lock", async () => {
  assert.deepEqual(personaSections(PERSONA).map(([h]: [string, number, number]) => h), ["Who you are", "How you work", "Off limits"]);
  const [, a, b] = personaSections(PERSONA)[1];
  assert.equal(PERSONA.slice(a, b), "\nNew way.\n\n### Detail\n\nkept inside\n\n");
  const f = await fixture();
  await mkdir(path.join(f.dir, "scout"));
  const file = path.join(f.dir, "scout", "persona.md");
  const live = "# Scout\n\n## Who you are\n\nYou scout.\n\n## How you work\nNew way.\n\n## Off limits\n\nNever pay.\n";
  await writeFile(file, live);
  const files = { proposals: f.proposals, plan: path.join(f.dir, "wp.json"), goals: path.join(f.dir, "dg.json"), applied: path.join(f.dir, "applied.jsonl"), bots: f.dir };
  const c = parseChanges(await readFile(f.proposals, "utf8"))[0];
  assert.deepEqual([c.part, c.section, sideText(c, "before"), sideText(c, "after"), canUndo(c, NOW)], ["persona", "How you work", "Old way.", "New way.", true]);
  // changed since: nothing written
  await writeFile(file, live.replace("New way.", "The owner's way."));
  assert.deepEqual(await undo("c-persona", "Owner", files, NOW), { ok: false, error: CHANGED_SINCE });
  await writeFile(file, live);
  const r = await undo("c-persona", "Owner", files, NOW);
  assert.equal(r.ok, true);
  assert.equal(await readFile(file, "utf8"), "# Scout\n\n## Who you are\n\nYou scout.\n\n## How you work\nOld way.\n\n## Off limits\n\nNever pay.\n");
  await assert.rejects(stat(`${file}.lock`));
  const log = JSON.parse((await readFile(files.applied, "utf8")).trim());
  assert.deepEqual([log.field, log.before, log.after, log.undo], ["persona:How you work", "New way.\n\n", "Old way.\n\n", true]);
  assert.equal((await rec(f.proposals, "c-persona")).status, "undone");
});

test("an owner item for a persona section carries what Revert needs; a member with no art gets a look of its own", () => {
  const items = parseOwnerItems(JSON.stringify({ items: [
    { id: "o-persona-1", ts: "2026-11-11T13:00", title: "persona Scout, section 'Off limits' changed outside a CEO change at 12:55: keep (say so) or revert", how: "Keep or Revert", bot: "scout", section: "Off limits", before: "Never pay.\n\n", status: "open" },
    { id: "o-plain", title: "Cloudflare token", how: "save it", status: "open" },
    { id: "o-bad", title: "bad slug", bot: "../etc", section: "x", before: "y", status: "open" },
  ] }));
  assert.deepEqual(items[0].persona, { bot: "scout", section: "Off limits", before: "Never pay.\n\n" });
  assert.equal(items[1].persona, undefined);
  assert.equal(items[2].persona, undefined);
  const look = lookOf("site-checker");
  assert.ok(look.shirt && look.accessory);
  assert.deepEqual(lookOf("site-checker"), look); // the same every time
});
