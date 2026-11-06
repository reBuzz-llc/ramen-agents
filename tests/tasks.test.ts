import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import type { Actor } from "@/lib/leads";
import { getTask, listTasks, onlyAdds, raiseTaskFlag, resolveTaskFlag, taskFlagsOf, taskHistory, writeTask } from "@/lib/tasks";
import { createTenant } from "@/lib/tenants";

const CEO: Actor = { kind: "bot", name: "The CEO", via: "engine" };
const BACKFILL: Actor = { kind: "bot", name: "backfill", via: "backfill" };
const PAGE = "00000000000040008000000000000302";

// What the fleet's tasks backfill sends for one Notion task (to_task()).
const NOTION_TASK = {
  notion_page_id: PAGE,
  notion_url: "https://www.notion.so/Send-first-emails-00000000000040008000000000000302",
  title: "Send first emails to SMB leads in NYC",
  status: "In progress",
  priority: "P0",
  assignees: ["Robin"],
  due: null,
  projects: ["00000000000040008000000000000301"],
  blocker: null,
  files: null,
  notion_uid: "T-185",
  created_at: "2026-10-27T09:12:00.000Z",
  details: "### Why\nThe first emails.\n### Done when\n- [x] 10 sent\n- [ ] 20 sent",
  checklist: [
    { text: "10 sent", done: true },
    { text: "20 sent", done: false },
  ],
  standing: true,
};

async function board() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
  return { db, tenantId: tenant.id, OLU };
}

describe("the backfill (PUT /api/tasks/by-notion)", () => {
  it("copies Notion as it is, status, assignees, ticks and created_at included, and a second copy changes nothing", async () => {
    const { db, tenantId } = await board();
    const { notion_page_id, ...task } = NOTION_TASK;
    const a = await writeTask(db, tenantId, { notionPageId: notion_page_id }, task, BACKFILL, { create: true, import: true });
    expect(a.ok && [a.created, a.refused]).toEqual([true, []]);
    const got = await getTask(db, tenantId, { notionPageId: PAGE });
    // the fields the backfill reads back and compares
    for (const [k, v] of Object.entries(NOTION_TASK)) expect([k, got![k] ?? null]).toEqual([k, v]);
    const b = await writeTask(db, tenantId, { notionPageId: PAGE }, task, BACKFILL, { create: true, import: true });
    expect(b.ok && [b.created, b.written, b.task.rev]).toEqual([false, [], a.ok && a.task.rev]);
    expect((await listTasks(db, tenantId)).tasks).toHaveLength(1);
  });
});

describe("who may change what", () => {
  it("a bot's new task starts Not started and unassigned; its Done-when list unticked", async () => {
    const { db, tenantId } = await board();
    const r = await writeTask(db, tenantId, {}, { title: "Write the menu page", status: "Done", assignees: ["Robin"], priority: "P1", checklist: [{ text: "draft", done: false }] }, CEO, { create: true });
    expect(r.ok && r.refused.map((x) => [x.field, x.reason])).toEqual([
      ["status", "human_only"],
      ["assignees", "human_only"],
    ]);
    expect(r.ok && r.task).toMatchObject({ status: "Not started", assignees: null, priority: "P1", checklist: [{ text: "draft", done: false }], created_by: "The CEO" });
  });

  it("status, assignees and ticks are the team's; a bot appends details and adds items; a person's field wins", async () => {
    const { db, tenantId, OLU } = await board();
    const made = await writeTask(db, tenantId, {}, { title: "Fix the hero", details: "### Why\nSlow.", checklist: [{ text: "a", done: false }] }, CEO, { create: true });
    const id = made.ok ? made.task.id : "";
    // a person ticks, moves the status, assigns, and sets the priority
    const p = await writeTask(db, tenantId, { id }, { status: "In progress", assignees: ["Olu"], checklist: [{ text: "a", done: true }], priority: "P2" }, OLU);
    expect(p.ok && p.written.sort()).toEqual(["assignees", "checklist", "priority", "status"]);
    // a bot cannot undo any of it
    const bot = await writeTask(db, tenantId, { id }, { status: "Done", checklist: [{ text: "a", done: false }], priority: "P0" }, CEO);
    expect(bot.ok && bot.refused.map((x) => [x.field, x.reason])).toEqual([
      ["status", "human_only"],
      ["checklist", "human_only"],
      ["priority", "person_wins"],
    ]);
    // but it may add an unticked item after the team's, and append to the details
    const add = await writeTask(db, tenantId, { id }, { checklist: [{ text: "a", done: true }, { text: "b", done: false }] }, CEO, { detailsAppend: "Send-next: 12 leads today." });
    expect(add.ok && add.written.sort()).toEqual(["checklist", "details"]);
    expect(add.ok && add.task).toMatchObject({ status: "In progress", priority: "P2", details: "### Why\nSlow.\n\nSend-next: 12 leads today.", checklist: [{ text: "a", done: true }, { text: "b", done: false }] });
    // appending works on details a person wrote too
    await writeTask(db, tenantId, { id }, { details: "Rewritten by Olu." }, OLU);
    const again = await writeTask(db, tenantId, { id }, {}, CEO, { detailsAppend: "One more line." });
    expect(again.ok && again.task.details).toBe("Rewritten by Olu.\n\nOne more line.");
    // replacing it is refused
    const replace = await writeTask(db, tenantId, { id }, { details: "Mine now." }, CEO);
    expect(replace.ok && replace.refused.map((x) => x.reason)).toEqual(["person_wins"]);
    // the history keeps every change and every refusal, newest first
    const h = await taskHistory(db, tenantId, id);
    expect(h.filter((x) => x.outcome === "refused").map((x) => x.column).sort()).toEqual(["checklist", "details", "priority", "status"]);
    expect(h.find((x) => x.column === "status" && x.outcome === "applied")).toMatchObject({ old: "Not started", new: "In progress", actor: { kind: "person", name: "Olu" } });
  });

  it("onlyAdds: the team's items stay as they are, new ones come unticked after them", () => {
    const a = [{ text: "x", done: true }];
    expect(onlyAdds(a, [...a, { text: "y", done: false }])).toBe(true);
    expect(onlyAdds(a, [{ text: "x", done: false }])).toBe(false);
    expect(onlyAdds(a, [])).toBe(false);
    expect(onlyAdds(a, [...a, { text: "y", done: true }])).toBe(false);
    expect(onlyAdds(null, [{ text: "y", done: false }])).toBe(true);
  });

  it("refuses unknown fields, bad statuses and priorities", async () => {
    const { db, tenantId } = await board();
    expect(await writeTask(db, tenantId, {}, { title: "t", colour: "red" }, CEO, { create: true })).toMatchObject({ ok: false, code: "bad_request" });
    expect(await writeTask(db, tenantId, {}, { title: "t", status: "Finished" }, CEO, { create: true })).toMatchObject({ ok: false, code: "bad_request" });
    expect(await writeTask(db, tenantId, {}, { title: "t", priority: "P9" }, CEO, { create: true })).toMatchObject({ ok: false, code: "bad_request" });
    expect(await writeTask(db, tenantId, { id: "00000000-0000-0000-0000-000000000000" }, { title: "t" }, CEO)).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("reading by rev, and the Validator's flags", () => {
  it("since returns only what changed after; a flag raised twice keeps its id, resolves, reopens", async () => {
    const { db, tenantId, OLU } = await board();
    const a = await writeTask(db, tenantId, {}, { title: "One" }, CEO, { create: true });
    const b = await writeTask(db, tenantId, {}, { title: "Two" }, CEO, { create: true });
    const first = await listTasks(db, tenantId);
    expect(first.tasks.map((t) => t.title)).toEqual(["One", "Two"]);
    await writeTask(db, tenantId, { id: a.ok ? a.task.id : "" }, { status: "Done" }, OLU);
    const next = await listTasks(db, tenantId, { since: first.next });
    expect(next.tasks.map((t) => [t.title, t.status])).toEqual([["One", "Done"]]);
    const id = b.ok ? b.task.id : "";
    const f = await raiseTaskFlag(db, tenantId, id, "T03", "no Done when", "validator");
    const g = await raiseTaskFlag(db, tenantId, id, "T03", "still no Done when", "validator");
    expect(g).toMatchObject({ id: f!.id, detail: "still no Done when", status: "open" });
    expect(await resolveTaskFlag(db, tenantId, id, f!.id, "validator")).toMatchObject({ status: "resolved" });
    expect((await raiseTaskFlag(db, tenantId, id, "T03", "again", "validator"))?.status).toBe("open");
    expect((await taskFlagsOf(db, tenantId, id))!.map((x) => x.rule)).toEqual(["T03"]);
    expect(await taskFlagsOf(db, tenantId, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("the queue", () => {
  it("lists open tasks as kind task: the standing one pinned, then the viewer's, then by priority; a person's tick lands as theirs", async () => {
    const { peekTasksOf } = await import("@/lib/queue");
    const { changeTask } = await import("@/lib/tasks");
    const { db, tenantId, OLU } = await board();
    const mk = async (fields: Record<string, unknown>) => {
      const r = await writeTask(db, tenantId, {}, fields, BACKFILL, { create: true, import: true });
      return r.ok ? r.task.id : "";
    };
    await mk({ title: "Low", priority: "P3" });
    const mine = await mk({ title: "Mine", priority: "P2", assignees: ["Olu"] });
    await mk({ title: "Urgent", priority: "P0", due: "2026-11-05" });
    await mk({ title: "Closed", priority: "P0", status: "Done" });
    const standing = await mk({ title: "Send first emails to SMB leads in NYC", standing: true, checklist: [{ text: "10 sent", done: false }] });
    const me = { userId: OLU.kind === "person" ? OLU.userId : "", name: "Olu", email: "o@acme.example" };
    const q = peekTasksOf((await listTasks(db, tenantId)).tasks, me, new Map());
    expect(q.map((t) => [t.task, t.mine, t.standing])).toEqual([
      ["Send first emails to SMB leads in NYC", false, true],
      ["Mine", true, false],
      ["Urgent", false, false],
      ["Low", false, false],
    ]);
    // taking a task makes it the viewer's
    expect(peekTasksOf((await listTasks(db, tenantId)).tasks, me, new Map([[mine, { userId: "x", name: "Ann" }]])).find((t) => t.pageId === mine)?.takenBy).toEqual({ name: "Ann", mine: false });
    // a tick names its item by place and text; a stale one is refused
    expect(await changeTask(db, tenantId, standing, OLU as Extract<Actor, { kind: "person" }>, { tick: { index: 0, text: "20 sent", done: true } })).toMatchObject({ ok: false, code: "bad_request" });
    const t = await changeTask(db, tenantId, standing, OLU as Extract<Actor, { kind: "person" }>, { tick: { index: 0, text: "10 sent", done: true } });
    expect(t.ok && t.task.checklist).toEqual([{ text: "10 sent", done: true }]);
    // the × on the status: back to Not started
    await changeTask(db, tenantId, mine, OLU as Extract<Actor, { kind: "person" }>, { status: "In Review" });
    const back = await changeTask(db, tenantId, mine, OLU as Extract<Actor, { kind: "person" }>, { status: "" });
    expect(back.ok && back.task.status).toBe("Not started");
    const h = await taskHistory(db, tenantId, standing);
    expect(h[0]).toMatchObject({ column: "checklist", actor: { kind: "person", name: "Olu" }, outcome: "applied" });
  });
});

describe("the bots' links: <peek>/tasks/<id> and <peek>/leads/<id>", () => {
  it("open the task's card on To-do and the lead's drawer; another company's id, an unknown one or a bad one is missing", async () => {
    const { leadLink, taskLink } = await import("@/lib/deep-links");
    const { writeLead } = await import("@/lib/leads");
    const { db, tenantId } = await board();
    const other = (await createTenant(db, "Other", "other", { email: "o@other.example", name: "Ot" })).tenant.id;
    const t = await writeTask(db, tenantId, {}, { title: "Fix the hero" }, CEO, { create: true });
    const done = await writeTask(db, tenantId, {}, { title: "Old", status: "Done" }, BACKFILL, { create: true, import: true });
    const l = await writeLead(db, tenantId, {}, { business: "Acme Bakery", website: "https://acmebakery.example" }, CEO, { create: true });
    const tid = t.ok ? t.task.id : "";
    const lid = l.ok ? l.lead.id : "";
    expect(await taskLink(db, tenantId, tid)).toEqual({ to: `/todo?task=${tid}&status=Not%20started` });
    expect(await taskLink(db, tenantId, done.ok ? done.task.id : "")).toMatchObject({ to: expect.stringContaining("status=Done") });
    expect(await leadLink(db, tenantId, lid)).toEqual({ to: `/leads?lead=${lid}` });
    for (const [fn, id] of [[taskLink, tid], [leadLink, lid]] as const) {
      expect(await fn(db, other, id)).toEqual({ missing: true }); // another company's
      expect(await fn(db, tenantId, "00000000-0000-0000-0000-000000000000")).toEqual({ missing: true });
      expect(await fn(db, tenantId, "not-an-id'; drop table")).toEqual({ missing: true });
    }
  });

  it("the routes use them and answer a real 404 with the way back; the views open what the link names", async () => {
    const { readFileSync } = await import("node:fs");
    const { missingPage } = await import("@/lib/deep-links");
    const src = (f: string) => readFileSync(f, "utf8");
    for (const [k, fn] of [["tasks", "taskLink"], ["leads", "leadLink"]]) expect(src(`app/${k}/[id]/route.ts`)).toContain(`const r = await ${fn}(await db(), who.tenantId, id);`);
    expect(src("app/tasks/[id]/route.ts")).toMatch(/if \("missing" in r\) return missingPage\(/);
    // a lead someone cannot open lands on the Leads page, which says so in one line
    expect(src("app/leads/[id]/route.ts")).toMatch(/redirect\("missing" in r \? leadPath\(/);
    expect(src("app/tasks/[id]/route.ts")).toContain('{ href: "/todo", label: "To-do" }');
    const res = missingPage("task", { href: "/todo", label: "To-do" });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('<a href="/todo">← Back to To-do</a>');
    expect(src("app/leads/page.tsx")).toMatch(/openId=\{openId\}/);
    expect(src("app/leads/leads-view.tsx")).toMatch(/useState<string \| null>\(openId\)/);
    expect(src("app/todo/todo-view.tsx")).toMatch(/focused=\{focus\?\.id === t\.pageId\}/);
    // an old Our-queue task link still lands on its card
    expect(src("app/queue/page.tsx")).toMatch(/if \(task\) redirect\(`\/todo\?task=/);
  });
});

describe("a lead's link", () => {
  it("round trip: the canonical address opens that lead; another company's, an archived one or a bad id says unavailable", async () => {
    const { memoryDb } = await import("@/lib/db");
    const { createTenant } = await import("@/lib/tenants");
    const { writeLead } = await import("@/lib/leads");
    const { leadLink, leadPath, leadToOpen } = await import("@/lib/deep-links");
    const db = await memoryDb();
    const a = (await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" })).tenant.id;
    const b = (await createTenant(db, "Beta", "beta", { email: "o@beta.example", name: "Bo" })).tenant.id;
    const bot = { kind: "bot" as const, name: "Lead Gen", via: "engine" };
    const l = await writeLead(db, a, {}, { business: "Acme Bakery", website: "https://acmebakery.example" }, bot, { create: true });
    const old = await writeLead(db, a, {}, { business: "Gone Cafe", website: "https://gonecafe.example" }, bot, { create: true });
    const id = l.ok ? l.lead.id : "";
    const gone = old.ok ? old.lead.id : "";
    const { leads } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(leads).set({ archived: true }).where(eq(leads.id, gone));
    // the link a bot records, and Copy link's address, both resolve to the same drawer
    const link = await leadLink(db, a, id);
    expect(link).toEqual({ to: leadPath(id) });
    const param = new URL(`https://peek.example${leadPath(id)}`).searchParams.get("lead");
    expect(await leadToOpen(db, a, param)).toEqual({ openId: id, unavailable: false });
    // the older ?open= value works the same
    expect(await leadToOpen(db, a, id)).toEqual({ openId: id, unavailable: false });
    for (const raw of [gone, "00000000-0000-0000-0000-000000000000", "not-an-id"]) expect(await leadToOpen(db, a, raw)).toEqual({ openId: null, unavailable: true });
    expect(await leadToOpen(db, b, id)).toEqual({ openId: null, unavailable: true }); // another company's: no hint it exists
    expect(await leadToOpen(db, a, undefined)).toEqual({ openId: null, unavailable: false });
  });
});
