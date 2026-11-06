import { describe, expect, it } from "vitest";
import { withAttachments } from "@/lib/attachment-line";
import { accept, holderOf } from "@/lib/claims";
import { memoryDb } from "@/lib/db";
import { files, leadFiles } from "@/lib/db/schema";
import {
  draftsOfLead,
  scoreFacts,
  leadQueue,
  markFields,
  markLead,
  sentSinceOnPeek,
} from "@/lib/lead-queue";
import { getLead, historyOf, writeLead, type Actor } from "@/lib/leads";
import { scoreboard } from "@/lib/scoreboard";
import { sendNext } from "@/lib/send-next";
import { writeTask } from "@/lib/tasks";
import { createTenant } from "@/lib/tenants";
import { eq } from "drizzle-orm";

const eqId = (id: string) => eq(files.id, id);

const BOT: Actor = { kind: "bot", name: "outA", via: "outreach-writer" };

async function board() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", {
    email: "o@acme.example",
    name: "Olu",
  });
  const OLU = { kind: "person" as const, name: "Olu", userId: owner.id };
  const add = async (business: string, fields: Record<string, unknown>) => {
    const r = await writeLead(
      db,
      tenant.id,
      {},
      {
        business,
        website: `https://${business.toLowerCase().replace(/\W/g, "")}.example`,
        ...fields,
      },
      BOT,
      { create: true },
    );
    if (!r.ok) throw new Error(r.message);
    return r.lead.id;
  };
  return { db, tenantId: tenant.id, OLU, owner, add };
}

describe("Our queue on the portal's board", () => {
  it("lists drafted rows with no result: no status to review, Ready to Send Email to send, best score first", async () => {
    const { db, tenantId, OLU, add } = await board();
    const a = await add("Alpha", { draft_email: "Hi Alpha", lead_score: 40 });
    await add("Blank", {}); // no draft
    await add("Skipper", { draft_email: "skip: the site is gone" }); // the writer's verdict, not an email
    const sent = await add("Sent", { draft_email: "Hi" });
    await writeLead(db, tenantId, { id: sent }, markFields("Email Sent"), OLU);
    const answered = await add("Answered", { draft_email: "Hi" });
    await writeLead(db, tenantId, { id: answered }, { result: "Replied" }, OLU);
    const ready = await add("Ready", {
      draft_email: "Hi Ready",
      lead_score: 90,
    });
    await writeLead(
      db,
      tenantId,
      { id: ready },
      markFields("Ready to Send Email"),
      OLU,
    );
    const wa = await add("Waonly", {
      draft_email: "Hi",
      whatsapp: "https://wa.me/17185550100",
    });
    await writeLead(
      db,
      tenantId,
      { id: wa },
      { whatsapp_status: "WhatsApp Verified" },
      OLU,
    ); // a WhatsApp check is not an email decision

    const q = await leadQueue(db, tenantId);
    expect(q.map((r) => [r.business, r.kind])).toEqual([
      ["Ready", "send"],
      ["Alpha", "review"],
      ["Waonly", "review"],
    ]);
    expect(q.find((r) => r.pageId === a)).toMatchObject({
      draft: "Hi Alpha",
      draftCut: false,
      url: `/leads/${a}`,
      score: 40,
    });
  });

  it("carries the start of a long draft and reads the whole draft on demand", async () => {
    const { db, tenantId, add } = await board();
    const long = `Hi there,\n${"word ".repeat(200)}`;
    const id = await add("Longdraft", {
      draft_email: long,
      draft_whatsapp: "Hello",
    });
    const [r] = await leadQueue(db, tenantId);
    expect(r.draftCut).toBe(true);
    expect(r.draft.length).toBeLessThanOrEqual(300);
    expect(await draftsOfLead(db, tenantId, id)).toEqual({
      draft: long.trim(),
      whatsappDraft: "Hello",
    });
  });

  it("'Reviewed, ready to send' and 'I sent it' write the drawer's steps as the person, with Sent by and Sent at", async () => {
    const { db, tenantId, OLU, add } = await board();
    const id = await add("Bravo", { draft_email: "Hi Bravo" });
    const now = new Date("2026-11-05T15:00:00Z");
    expect(
      await markLead(db, tenantId, id, "Ready to Send Email", OLU, now),
    ).toEqual({ ok: true, status: "Ready to Send Email" });
    expect(await markLead(db, tenantId, id, "Email Sent", OLU, now)).toEqual({
      ok: true,
      status: "Email Sent",
    });
    const l = await getLead(db, tenantId, { id });
    expect(l).toMatchObject({
      email_status: "Email Sent",
      result: "Emailed",
      result_date: "2026-11-05",
      sent_by: ["Olu"],
    });
    expect(l?.sent_at).toBeTruthy();
    const h = await historyOf(db, tenantId, id);
    expect(
      h
        .filter((x) => x.column === "email_status")
        .every((x) => x.actor.kind === "person" && x.actor.name === "Olu"),
    ).toBe(true);
    expect(await leadQueue(db, tenantId)).toEqual([]); // sent: out of the queue
  });

  it("is refused for a bot: the email status is the team's", async () => {
    const { db, tenantId, add } = await board();
    const id = await add("Charlie", { draft_email: "Hi" });
    const r = await markLead(db, tenantId, id, "Email Sent", BOT);
    expect(r.ok).toBe(false);
    expect((await getLead(db, tenantId, { id }))?.email_status).toBeNull();
  });

  it("shares its claims with Send next: a lead taken in one is taken in the other", async () => {
    const { db, tenantId, owner, add } = await board();
    const id = await add("Delta", { draft_email: "Hi Delta" });
    expect((await accept(db, tenantId, id, owner.id)).ok).toBe(true); // the queue's Accept, by lead id
    expect((await holderOf(db, tenantId, id))?.userId).toBe(owner.id);
    const next = await sendNext(db, tenantId);
    expect(next.rows.find((r) => r.id === id)?.takenBy?.userId).toBe(owner.id);
  });

  it("counts this week's sent emails by sent date, else result date", async () => {
    const { db, tenantId, OLU, add } = await board();
    const now = await add("Now", { draft_email: "Hi" });
    await markLead(db, tenantId, now, "Email Sent", OLU);
    // an imported row: Email Sent with a result date but no sent_at
    await writeLead(
      db,
      tenantId,
      {},
      {
        business: "Old",
        website: "https://old.example",
        email_status: "Email Sent",
        result: "Emailed",
        result_date: "2026-01-02",
      },
      OLU,
      { create: true, import: true },
    );
    const today = new Date().toISOString().slice(0, 10);
    expect(await sentSinceOnPeek(db, tenantId, today)).toBe(1);
    expect(await sentSinceOnPeek(db, tenantId, "2026-01-01")).toBe(2);
    expect(await sentSinceOnPeek(db, tenantId, "2026-01-03")).toBe(1);
  });

  it("names a lead's attachments on the queue row, and Copy draft ends with them, like Send next and the drawer", async () => {
    const { db, tenantId, add } = await board();
    const id = await add("Echo", { draft_email: "Hi Echo\n" });
    const [f1, f2, gone] = await db
      .insert(files)
      .values(
        ["menu.pdf", "logo.png", "old.pdf"].map((name, i) => ({
          tenantId,
          key: `k${i}`,
          name,
          size: 1,
          contentType: "application/pdf",
          status: "ready",
        })),
      )
      .returning();
    await db.update(files).set({ deletedAt: new Date() }).where(eqId(gone.id));
    for (const f of [f1, f2, gone])
      await db.insert(leadFiles).values({ tenantId, leadId: id, fileId: f.id });
    const [row] = await leadQueue(db, tenantId);
    expect(row.attachments).toEqual(["menu.pdf", "logo.png"]);
    expect(withAttachments(row.draft, row.attachments)).toBe(
      "Hi Echo\n\nAttachments: menu.pdf, logo.png",
    );
    expect((await sendNext(db, tenantId)).rows[0].attachments).toEqual([
      "menu.pdf",
      "logo.png",
    ]); // the same reader
    expect(withAttachments("Hi", [])).toBe("Hi");
  });

  it("feeds This week, the Leaderboard and statements from Peek's board: sent leads, results and Done tasks", async () => {
    const { db, tenantId, OLU, owner, add } = await board();
    const from = new Date(Date.now() - 86400e3);
    const a = await add("Foxtrot", { draft_email: "Hi" });
    await markLead(db, tenantId, a, "Email Sent", OLU);
    await writeLead(
      db,
      tenantId,
      { id: a },
      { result: "Meeting", result_date: new Date().toISOString().slice(0, 10) },
      OLU,
    );
    await add("Golf", { draft_email: "Hi" }); // not sent: not counted
    await writeTask(
      db,
      tenantId,
      {},
      { title: "Fix the menu page", status: "Done", assignees: ["Olu"] },
      OLU,
      { create: true },
    );
    await writeTask(
      db,
      tenantId,
      {},
      { title: "Still open", status: "In progress", assignees: ["Olu"] },
      OLU,
      { create: true },
    );
    const facts = await scoreFacts(db, tenantId, from);
    expect(facts.leads.map((l) => l.id)).toEqual([a]);
    expect(facts.tasks).toHaveLength(1);
    const people = [
      {
        id: owner.id,
        name: "Olu",
        email: "o@acme.example",
        role: "owner",
        notionUserId: null,
      },
    ];
    const [olu] = scoreboard(people, [], facts.leads, facts.tasks, [], from);
    expect(olu).toMatchObject({
      sent: 1,
      replies: 1,
      meetings: 1,
      clients: 0,
      tasksDone: 1,
    });
  });
});
