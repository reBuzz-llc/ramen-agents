// C11 of an independent read: the Drafts fixed and Follow-ups lines count by user id, so a member with
// the owner's name keeps their numbers while the owner's account stays off the board.
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { personLeadsSince } from "@/lib/draft-edits";
import { markFollowUp } from "@/lib/follow-up";
import { writeLead, type Actor } from "@/lib/leads";
import { offBoardIds } from "@/lib/team-board";
import { addUser, createTenant } from "@/lib/tenants";

describe("by user id, never by name", () => {
  it("two people named Sam: the member's follow-ups and draft fixes are theirs, the owner's stay off", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "sam@acme.example", name: "Sam" });
    const member = await addUser(db, tenant.id, "sam.two@acme.example", "Sam");
    const OWNER: Actor = { kind: "person", name: "Sam", userId: owner.id };
    const MEMBER: Actor = { kind: "person", name: "Sam", userId: member.id };
    const lead = async (business: string) => {
      const r = await writeLead(db, tenant.id, {}, { business, email_status: "Email Sent", sent_by: ["Sam"] }, OWNER, { create: true });
      if (!r.ok) throw new Error(r.message);
      return r.lead.id;
    };
    const [a, b, c] = [await lead("A Cafe"), await lead("B Deli"), await lead("C Grill")];
    for (const id of [a, b]) expect(await markFollowUp(db, tenant.id, id, { userId: member.id, name: "Sam" })).toMatchObject({ ok: true });
    expect(await markFollowUp(db, tenant.id, c, { userId: owner.id, name: "Sam" })).toMatchObject({ ok: true });
    await writeLead(db, tenant.id, { id: a }, { draft_email: "Hi there, a better first line." }, MEMBER);
    const follow = await personLeadsSince(db, tenant.id, ["follow_up_by"], "2000-01-01");
    const fixed = await personLeadsSince(db, tenant.id, ["draft_email", "draft_whatsapp"], "2000-01-01");
    expect(follow.get(member.id)).toBe(2);
    expect(follow.get(owner.id)).toBe(1);
    expect(fixed.get(member.id)).toBe(1);
    // the board leaves the owner's account off by id; the member with the owner's name stays
    const off = offBoardIds([{ id: owner.id, role: "owner" }, { id: member.id, role: "member" }], {});
    expect([...follow.keys()].filter((id) => !off.has(id))).toEqual([member.id]);
  });
});
