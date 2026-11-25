// A person's rewrite of a Writer draft offered as its group's template. The offer after a save, the person's
// answer (first answer wins), the Validator's list, open and change, and an approval replacing the group's earlier one.
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { writeLead, type Actor } from "@/lib/leads";
import { answerOnPeek, listProposals, offerFor, openProposal, patchProposal, proposalId } from "@/lib/template-proposals";
import { createTenant } from "@/lib/tenants";

const WRITER: Actor = { kind: "bot", name: "Outreach Writer", via: "engine" };
const DRAFT = (b: string) => `Hello ${b} team,\nWe noticed you don't have a website of your own, so customers find only your Google listing.\nWe'd like to build you a website for free.\nRegards,\nRosa\n-- Acme Sites`;
const REWRITE = (b: string) => `Hi there ${b},\nWe built a free sample website for your business already; it takes two minutes to look at and costs nothing.\nReply with a good time and we will walk you through it.\nRegards,\nRosa\n-- Acme Sites`;

async function setup() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const mk = async (business: string, pkg = "Starter Website") => {
    const r = await writeLead(db, tenant.id, {}, { business, city: "Brooklyn", package: pkg }, OLU, { create: true });
    if (!r.ok) throw new Error(r.message);
    await writeLead(db, tenant.id, { id: r.lead.id }, { draft_email: DRAFT(business) }, WRITER);
    return String(r.lead.id);
  };
  const edit = async (lead: string, text: string) => {
    const r = await writeLead(db, tenant.id, { id: lead }, { draft_email: text }, OLU);
    if (!r.ok) throw new Error(r.message);
    return r.changes![0];
  };
  return { db, t: tenant.id, owner, mk, edit };
}

describe("the offer and the person's answer", () => {
  it("offers a real rewrite for the group's untouched drafts; Yes approves it; a second answer is refused", async () => {
    const { db, t, owner, mk, edit } = await setup();
    const a = await mk("Candy Cloud"), b = await mk("Luna Bakes"), c = await mk("Pretty Nails");
    await mk("Other Pack", "SMB Website Care Retainer"); // another group: not counted
    await edit(c, "my own words for this one only, nothing like the draft at all, a completely new letter"); // touched: not counted
    const e = await edit(a, REWRITE("Candy Cloud"));
    const offer = await offerFor(db, t, a, e, owner.id);
    expect(offer).toMatchObject({ channel: "email", group: "Starter Website", count: 1, words: "the other 1 no-website leads" });
    expect(await offerFor(db, t, a, e, "00000000-0000-0000-0000-000000000000")).toBeNull(); // only the person who saved
    const p = await answerOnPeek(db, t, a, e, true, "Olu");
    expect(p).toMatchObject({ status: "approved", decided_where: "peek", decided_by: "Olu", opened_by: "peek", checked: false, failed_rules: [], placeholders: ["<business>"] });
    expect(p.template).toContain("Hi there <business>,");
    expect(p.id).toBe(proposalId("Starter Website", "email", new Date(p.edited_at), e));
    await expect(answerOnPeek(db, t, a, e, false, "Olu")).rejects.toMatchObject({ status: 409 });
    expect(await offerFor(db, t, a, e, owner.id)).toBeNull(); // answered
    void b;
  });

  it("no offer for a small fix, or for a text kept one-off before", async () => {
    const { db, t, owner, mk, edit } = await setup();
    const a = await mk("Candy Cloud");
    await mk("Luna Bakes");
    const small = await edit(a, DRAFT("Candy Cloud").replace("Hello", "Hi"));
    expect(await offerFor(db, t, a, small, owner.id)).toBeNull();
    const e = await edit(a, REWRITE("Candy Cloud"));
    await answerOnPeek(db, t, a, e, false, "Olu");
    const again = await edit(a, REWRITE("Candy Cloud").replace("Hi there", "Hi  there")); // the same text again (spacing aside)
    expect(await offerFor(db, t, a, again, owner.id)).toBeNull();
  });
});

describe("the Validator's side", () => {
  it("opens one for an unanswered edit, fills its checks, takes the owner's answer once, and an approval replaces the earlier", async () => {
    const { db, t, mk, edit } = await setup();
    const a = await mk("Candy Cloud"), b = await mk("Luna Bakes");
    await mk("Pretty Nails");
    const first = await answerOnPeek(db, t, a, await edit(a, REWRITE("Candy Cloud")), true, "Olu");
    const e2 = await edit(b, `Good day ${"Luna Bakes"}, a different approach: a short note about a free page we prepared for you to see.`);
    const open = await openProposal(db, t, b, e2);
    expect(open).toMatchObject({ status: "open", opened_by: "validator" });
    await expect(openProposal(db, t, b, e2)).rejects.toMatchObject({ status: 409 });
    expect(await patchProposal(db, t, open.id, { failed_rules: [{ rule: "OW01", detail: "sign-off missing" }], checked: true, count: 4 })).toMatchObject({ checked: true, count: 4, failed_rules: [{ rule: "OW01" }] });
    expect(await patchProposal(db, t, open.id, { status: "approved", decided_by: "the owner" })).toMatchObject({ status: "approved", decided_where: "decisions_box" });
    await expect(patchProposal(db, t, open.id, { status: "declined" })).rejects.toMatchObject({ status: 409 });
    const all = await listProposals(db, t);
    expect(all.find((x) => x.id === first.id)?.status).toBe("replaced");
    expect((await listProposals(db, t, { status: "approved" })).map((x) => x.id)).toEqual([open.id]);
  });
});

// An open proposal's text uplifted through the Validator's key, with an optional label
// of who wrote the new text; the earlier text kept in template_history; the person's own words (after) never change.
describe("uplifting an open proposal's text", () => {
  const VALIDATOR = { key: "validator", validator: true };
  const NEW = "Hi <business> team,\n\nA better letter for <business>.\n\nBest,\nAnna";
  async function open() {
    const s = await setup();
    const a = await s.mk("Candy Cloud");
    await s.mk("Luna Bakes");
    const e = await s.edit(a, REWRITE("Candy Cloud"));
    return { ...s, p: await openProposal(s.db, s.t, a, e) };
  }

  it("the Validator's key changes the text; the earlier one is kept with when, the label and the key", async () => {
    const { db, t, p } = await open();
    const out = await patchProposal(db, t, p.id, { template: `${NEW}\r\n`, by: "  a reviewer, on the team's yes  " }, VALIDATOR);
    expect(out.template).toBe(NEW);
    expect(out.after).toBe(p.after);
    expect(out.status).toBe("open");
    expect(out.template_history).toEqual([{ template: p.template, placeholders: p.placeholders, at: out.uplifted_at, by: "a reviewer, on the team's yes", via: "validator" }]);
    expect(out.uplifted_by).toBe("a reviewer, on the team's yes");
    // the same text again adds nothing; without a label the entry's by is empty
    expect((await patchProposal(db, t, p.id, { template: NEW }, VALIDATOR)).template_history).toHaveLength(1);
    const again = await patchProposal(db, t, p.id, { template: `${NEW}\nP.S. hello` }, VALIDATOR);
    expect(again.template_history).toHaveLength(2);
    expect(again.uplifted_by).toBe("");
    expect((await listProposals(db, t)).find((x) => x.id === p.id)?.template_history).toHaveLength(2);
  });

  it("refused: another key, a missing placeholder, an answer in the same call, a decided proposal", async () => {
    const { db, t, p } = await open();
    await expect(patchProposal(db, t, p.id, { template: NEW }, { key: "engine", validator: false })).rejects.toMatchObject({ status: 403 });
    await expect(patchProposal(db, t, p.id, { template: NEW })).rejects.toMatchObject({ status: 403 });
    await expect(patchProposal(db, t, p.id, { template: "Hi there, no name here." }, VALIDATOR)).rejects.toMatchObject({ status: 400, message: "the template does not carry <business>" });
    await expect(patchProposal(db, t, p.id, { template: "  " }, VALIDATOR)).rejects.toMatchObject({ status: 400 });
    await expect(patchProposal(db, t, p.id, { by: "someone" }, VALIDATOR)).rejects.toMatchObject({ status: 400, message: "send the new template" });
    await expect(patchProposal(db, t, p.id, { template: NEW, status: "approved" }, VALIDATOR)).rejects.toMatchObject({ status: 400 });
    expect((await patchProposal(db, t, p.id, { template: "Hi team at your place.", placeholders: [] }, VALIDATOR)).placeholders).toEqual([]);
    await patchProposal(db, t, p.id, { status: "approved", decided_by: "the owner" }, VALIDATOR);
    await expect(patchProposal(db, t, p.id, { template: NEW }, VALIDATOR)).rejects.toMatchObject({ status: 409 });
  });
});
