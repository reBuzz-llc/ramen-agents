// The send log and the sample link test. Which message carries the link, who is in which group, what counts as a
// reply, and that the log can never fail a Mark sent or hold a person.
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { markSent, type Preview } from "@/lib/already-sent";
import { accept } from "@/lib/claims";
import { memoryDb, type Db } from "@/lib/db";
import { leadSampleTests, leadSends } from "@/lib/db/schema";
import { answerSend, sampleTestResults, sendLogOf, withFirstLink } from "@/lib/lead-sends";
import { clearStatus, writeLead, type Actor } from "@/lib/leads";
import { packOf } from "@/lib/send-pack";
import { countAndPercent, fisherP, firstMessageLink, nextVariant, parseAmount, sendVariant, settleOutcome, summarise, verdict } from "@/lib/send-test";
import { createTenant } from "@/lib/tenants";

const URL_A = "https://samples.pages.dev/shop/";

describe("which message carries the link", () => {
  it("email follows the group; WhatsApp never carries it cold; after a reply it always may", () => {
    expect(firstMessageLink("email", URL_A, "link_first", null)).toBe(URL_A);
    expect(firstMessageLink("email", URL_A, "after_reply", "Emailed")).toBeNull();
    expect(firstMessageLink("whatsapp", URL_A, "link_first", null)).toBeNull();
    expect(firstMessageLink("email", URL_A, "after_reply", "Replied")).toBe(URL_A);
    expect(firstMessageLink("whatsapp", URL_A, "after_reply", "Meeting")).toBe(URL_A);
    expect(firstMessageLink("email", "", "link_first", null)).toBeNull();
  });

  it("logs a send under the group it really followed", () => {
    expect(sendVariant({ channel: "email", url: "", assigned: null, draft: "hi" })).toBe("no_sample");
    expect(sendVariant({ channel: "email", url: URL_A, assigned: "link_first", draft: "hi" })).toBe("link_first");
    expect(sendVariant({ channel: "email", url: URL_A, assigned: "after_reply", draft: "hi" })).toBe("after_reply");
    expect(sendVariant({ channel: "email", url: URL_A, assigned: "after_reply", draft: `hi ${URL_A}` })).toBe("off_test");
    expect(sendVariant({ channel: "email", url: URL_A, assigned: null, draft: "hi" })).toBe("off_test");
    expect(sendVariant({ channel: "email", url: URL_A, assigned: "link_first", draft: "hi", past: true })).toBe("off_test");
    expect(sendVariant({ channel: "whatsapp", url: URL_A, assigned: "link_first", draft: "hi" })).toBe("after_reply");
  });

  it("alternates", () => {
    expect([nextVariant(0, 0), nextVariant(1, 0), nextVariant(1, 1), nextVariant(2, 1)]).toEqual(["link_first", "after_reply", "link_first", "after_reply"]);
  });
});

describe("the numbers", () => {
  it("Fisher's exact test matches the published values", () => {
    expect(fisherP(3, 1, 1, 3)).toBeCloseTo(0.4857, 4);
    expect(fisherP(1, 9, 11, 3)).toBeCloseTo(0.002759, 5);
    expect(fisherP(0, 10, 0, 10)).toBeCloseTo(1, 9);
  });

  it("says too few under 30, no clear difference, or a clear one", () => {
    expect(verdict(5, 29, 0, 100).kind).toBe("few");
    expect(verdict(3, 40, 4, 40).kind).toBe("none");
    const v = verdict(20, 40, 4, 40);
    expect(v).toMatchObject({ kind: "clear", better: "first" });
    expect(verdict(4, 40, 20, 40)).toMatchObject({ kind: "clear", better: "second" });
  });

  it("always shows the count beside the percent", () => {
    expect(countAndPercent(3, 40)).toBe("3 of 40 (7.5%)");
    expect(countAndPercent(20, 40)).toBe("20 of 40 (50%)");
    expect(countAndPercent(0, 0)).toBe("0 of 0");
  });

  it("reads an amount as a person types it", () => {
    expect(parseAmount("$1,200.50")).toBe(120050);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount("abc")).toBe("bad");
    expect(parseAmount("-5")).toBe("bad");
  });

  it("leaves a bounce out of the sends", () => {
    const base = { channel: "email", variant: "no_sample", repliedAt: null, closedAt: null, amountCents: null };
    const { buckets } = summarise([{ ...base, leadId: "a", result: "Bounced" }, { ...base, leadId: "b", result: null }]);
    expect(buckets.get("email:no_sample")).toMatchObject({ sends: 1, bounced: 1 });
  });

  it("never guesses which channel got the reply", () => {
    const now = new Date();
    const row = (id: string, channel: string) => ({ id, channel, repliedAt: null, closedAt: null, result: null, amountCents: null });
    const both = [row("e", "email"), row("w", "whatsapp")];
    const open = settleOutcome(both, "Replied", null, now);
    expect(open.get("e")).toMatchObject({ repliedAt: null, result: "Replied" });
    expect(open.get("w")).toMatchObject({ repliedAt: null, result: "Replied" });
    const named = settleOutcome(both, "Replied", "whatsapp", now);
    expect(named.get("w")?.repliedAt).toEqual(now);
    expect(named.get("e")).toMatchObject({ repliedAt: null, result: null });
  });
});

async function board(n = 1) {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const who: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await writeLead(db, tenant.id, {}, { business: `Shop ${i}`, website: `https://shop${i}.example`, draft_email: "Hello there" }, who, { create: true });
    if (!r.ok) throw new Error(r.message);
    ids.push(String(r.lead.id));
  }
  return { db, tenantId: tenant.id, owner, who, ids };
}
const logOf = (db: Db, id: string) => db.select().from(leadSends).where(eq(leadSends.leadId, id));

describe("the log follows the board", () => {
  it("a Mark sent adds one row, with no extra step; saving again adds none; the × takes it away", async () => {
    const { db, tenantId, who, ids: [id] } = await board();
    await writeLead(db, tenantId, { id }, { email_status: "Email Sent", result: "Emailed" }, who);
    await writeLead(db, tenantId, { id }, { notes: "called" }, who);
    const rows = await logOf(db, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "email", variant: "no_sample", source: "mark", repliedAt: null });
    await clearStatus(db, tenantId, id, "email_status", who as Extract<Actor, { kind: "person" }>);
    expect(await logOf(db, id)).toHaveLength(0);
  });

  it("the Result fills the reply and the close, an amount goes on a win, and clearing it empties them", async () => {
    const { db, tenantId, who, ids: [id] } = await board();
    await writeLead(db, tenantId, { id }, { email_status: "Email Sent", result: "Emailed" }, who);
    await writeLead(db, tenantId, { id }, { result: "Replied" }, who);
    expect((await logOf(db, id))[0].repliedAt).not.toBeNull();
    expect(await answerSend(db, tenantId, id, { amount: "500" })).toMatchObject({ ok: false });
    await writeLead(db, tenantId, { id }, { result: "Client" }, who);
    expect(await answerSend(db, tenantId, id, { amount: "$1,200" })).toEqual({ ok: true });
    expect((await logOf(db, id))[0]).toMatchObject({ result: "Client", amountCents: 120000 });
    expect((await logOf(db, id))[0].closedAt).not.toBeNull();
    await clearStatus(db, tenantId, id, "result", who as Extract<Actor, { kind: "person" }>);
    expect((await logOf(db, id))[0]).toMatchObject({ repliedAt: null, closedAt: null, result: null, amountCents: null });
  });

  it("a lead sent on both channels counts its reply only once a person names the channel", async () => {
    const { db, tenantId, who, ids: [id] } = await board();
    await writeLead(db, tenantId, { id }, { email_status: "Email Sent", result: "Emailed", whatsapp: "https://wa.me/17185550147" }, who);
    await writeLead(db, tenantId, { id }, { whatsapp_status: "WhatsApp msg sent" }, who);
    await writeLead(db, tenantId, { id }, { result: "Replied" }, who);
    let r = await sampleTestResults(db, tenantId);
    expect(r.channelNotSaid).toBe(1);
    expect(r.buckets.get("email:no_sample")?.replies).toBe(0);
    await answerSend(db, tenantId, id, { channel: "whatsapp" });
    r = await sampleTestResults(db, tenantId);
    expect(r.channelNotSaid).toBe(0);
    expect(r.buckets.get("whatsapp:no_sample")?.replies).toBe(1);
    expect(r.buckets.get("email:no_sample")?.replies).toBe(0);
  });

  it("a send marked after the fact is logged only with the date the person gave", async () => {
    const { db, tenantId, who, ids: [a, b] } = await board(2);
    const preview = {
      matched: [
        { leadId: a, business: "Shop 0", mark: "email_sent", already: false, date: "2026-11-10", hasDraft: true },
        { leadId: b, business: "Shop 1", mark: "email_sent", already: false, date: null, hasDraft: true },
      ],
    } as unknown as Preview;
    await markSent(db, tenantId, preview, who);
    const dated = await logOf(db, a);
    expect(dated[0].sentAt.toISOString().slice(0, 10)).toBe("2026-11-10");
    expect(dated[0].source).toBe("already_sent");
    expect(await logOf(db, b)).toHaveLength(0);
  });

  it("a broken log never fails a Mark sent, and its error names no data", async () => {
    const { db, tenantId, who, ids: [id] } = await board();
    await db.execute(sql`drop table lead_sends`);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await writeLead(db, tenantId, { id }, { email_status: "Email Sent", result: "Emailed" }, who);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lead.email_status).toBe("Email Sent");
    expect(err).toHaveBeenCalled();
    const said = err.mock.calls.flat().join(" ");
    expect(said).toContain("lead-sends");
    expect(said).not.toContain(id);
    expect(said).not.toContain("Olu");
    err.mockRestore();
    expect(await sendLogOf(db, tenantId, id)).toBeNull();
  });
});

describe("the groups", () => {
  it("a first public link puts a lead in a group, alternating; a lead already emailed stays out", async () => {
    const { db, tenantId, who, ids } = await board(4);
    await writeLead(db, tenantId, { id: ids[3] }, { email_status: "Email Sent", result: "Emailed" }, who);
    for (const id of ids) await writeLead(db, tenantId, { id }, { sample_url: `${URL_A}${id}/` }, who);
    const rows = await db.select().from(leadSampleTests).where(eq(leadSampleTests.tenantId, tenantId));
    const v = (id: string) => rows.find((r) => r.leadId === id)?.variant;
    expect([v(ids[0]), v(ids[1]), v(ids[2]), v(ids[3])]).toEqual(["link_first", "after_reply", "link_first", undefined]);
  });

  it("the pack holds the link back from an after-reply lead, and the send is logged under its group", async () => {
    const { db, tenantId, owner, who, ids } = await board(2);
    for (const id of ids) {
      await writeLead(db, tenantId, { id }, { sample_url: `${URL_A}${id}/` }, who);
      await accept(db, tenantId, id, owner.id);
    }
    const pack = await packOf(db, tenantId, owner.id);
    const first = pack.find((l) => l.id === ids[0])!;
    const after = pack.find((l) => l.id === ids[1])!;
    expect(first).toMatchObject({ sample: `${URL_A}${ids[0]}/`, sampleHeld: false });
    expect(after).toMatchObject({ sample: null, sampleHeld: true });
    await writeLead(db, tenantId, { id: ids[1] }, { email_status: "Email Sent", result: "Emailed" }, who);
    expect((await logOf(db, ids[1]))[0].variant).toBe("after_reply");
  });

  it("no public link falls back cleanly to no sample", async () => {
    const { db, tenantId, ids: [id] } = await board();
    const [r] = await withFirstLink(db, tenantId, "email", [{ id, sample: null }]);
    expect(r).toMatchObject({ sample: null, sampleHeld: false });
    expect((await db.select().from(leadSampleTests).where(and(eq(leadSampleTests.tenantId, tenantId), eq(leadSampleTests.leadId, id))))).toHaveLength(0);
  });
});

describe("lead data only", () => {
  it("the log has no person column, and its code and page read no person", () => {
    const cols = Object.values(leadSends).filter((c) => c && typeof c === "object" && "name" in c).map((c) => String((c as { name: string }).name));
    for (const bad of ["sent_by", "user_id", "actor_name", "actor_user_id", "by"]) expect(cols).not.toContain(bad);
    for (const f of ["lib/lead-sends.ts", "app/leads/sample-test/page.tsx"]) {
      const src = readFileSync(`${process.cwd()}/${f}`, "utf8");
      expect(src).not.toMatch(/\b(users|sentBy|leadCells|actorName|memberRates|shifts)\b/);
    }
  });

  it("the page carries the plain line, the method and the too-few wording", () => {
    const src = readFileSync(`${process.cwd()}/app/leads/sample-test/page.tsx`, "utf8");
    expect(src).toContain("Replies count only when someone marks them.");
    expect(src).toContain("{METHOD}");
    expect(src).toContain("Too few to tell");
    expect(src).toContain("No clear difference yet");
  });
});
