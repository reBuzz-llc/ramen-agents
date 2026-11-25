// A draft saying a website was created, with no approved sample, is off every send list while its OW27 note is
// open. The person sees one plain line, the draft is never changed, and no saved Send next list means nothing to send.
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import SendPack from "@/app/send-pack";
import WhatsAppPack from "@/app/whatsapp-pack";
import { accept } from "@/lib/claims";
import { memoryDb } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { raiseFlag, resolveFlag } from "@/lib/flags";
import { HELD_LINE } from "@/lib/held-drafts";
import { writeLead, type Actor } from "@/lib/leads";
import { sendNext } from "@/lib/send-next";
import { allPacks, fillPack, heldPack, packOf } from "@/lib/send-pack";
import { createTenant } from "@/lib/tenants";
import { heldSendList, sendList, VERIFIED } from "@/lib/whatsapp-pack";
import { saveBoardAsList } from "./helpers/saved-send-list";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const SAYS = "Hi, we created a website for you.";
const TODAY = { sent: 0, goal: 5, left: 5 };

async function board(n: number, extra: Record<string, unknown> = {}) {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const actor: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await writeLead(db, tenant.id, {}, { business: `Shop ${String(i).padStart(2, "0")}`, website: `https://shop${i}.example`, business_email: `hi@shop${i}.example`, whatsapp: `+1718555${String(1000 + i)}`, draft_email: SAYS, draft_whatsapp: SAYS, lead_score: 90 - i, ...extra }, actor, { create: true });
    if (!r.ok) throw new Error(r.message);
    ids.push(r.lead.id);
  }
  const hold = (id: string) => raiseFlag(db, tenant.id, id, "OW27", "the draft says a website was created", "validator");
  return { db, t: tenant.id, u: owner.id, ids, hold };
}

describe("the WhatsApp send list", () => {
  it("leaves a held lead out, still fills to ten, shows the reason, and takes it back once the note closes", async () => {
    const { db, t, u, ids, hold } = await board(12, { whatsapp_status: VERIFIED });
    const f = await hold(ids[0]);
    const list = await sendList(db, t, u);
    expect(list).toHaveLength(10);
    expect(list.map((l) => l.id)).not.toContain(ids[0]);
    expect((await heldSendList(db, t, u)).map((l) => l.id)).toEqual([ids[0]]);
    await resolveFlag(db, t, ids[0], f!.id, "validator");
    expect((await sendList(db, t, u)).map((l) => l.id)).toContain(ids[0]);
    expect(await heldSendList(db, t, u)).toEqual([]);
  });

  it("a different open note does not hold a lead", async () => {
    const { db, t, u, ids } = await board(1, { whatsapp_status: VERIFIED });
    await raiseFlag(db, t, ids[0], "OW09", "an invented figure", "validator");
    expect((await sendList(db, t, u)).map((l) => l.id)).toEqual(ids);
  });
});

describe("the email pack", () => {
  it("drops a lead taken before it was held, tops up without taking it again, and never changes its draft", async () => {
    const { db, t, u, ids, hold } = await board(12);
    await saveBoardAsList(db, t);
    await fillPack(db, t, u);
    expect((await packOf(db, t, u)).map((l) => l.id)).toContain(ids[0]);
    await hold(ids[0]);
    const pack = await packOf(db, t, u);
    expect(pack.map((l) => l.id)).not.toContain(ids[0]);
    expect((await heldPack(db, t, u)).map((l) => l.id)).toEqual([ids[0]]);
    expect((await allPacks(db, t))[0].leads.map((l) => l.id)).not.toContain(ids[0]);
    expect(await fillPack(db, t, u)).toBe(1);
    expect((await packOf(db, t, u)).map((l) => l.id)).not.toContain(ids[0]);
    const [row] = await db.select({ e: leads.draftEmail, w: leads.draftWhatsapp }).from(leads).where(eq(leads.id, ids[0]));
    expect(row).toEqual({ e: SAYS, w: SAYS });
  });
});

describe("Send next", () => {
  it("moves a lead held since the list was made to Held, with the reason, so a pack cannot take it", async () => {
    const { db, t, u, ids, hold } = await board(3);
    await saveBoardAsList(db, t);
    await hold(ids[0]);
    const s = await sendNext(db, t);
    expect(s.rows.map((r) => r.id)).toEqual([ids[1], ids[2]]);
    expect(s.held).toEqual([{ business: "Shop 00", reason: HELD_LINE }]);
    await fillPack(db, t, u);
    expect(await heldPack(db, t, u)).toEqual([]);
  });

  it("with no saved list shows nothing to send and takes nothing", async () => {
    const { db, t, u } = await board(3);
    expect(await sendNext(db, t)).toMatchObject({ source: "none", rows: [], held: [] });
    expect(await fillPack(db, t, u)).toBe(0);
  });

  it("someone holding it elsewhere does not change the hold", async () => {
    const { db, t, u, ids, hold } = await board(1);
    await accept(db, t, ids[0], u);
    await hold(ids[0]);
    expect(await packOf(db, t, u)).toEqual([]);
  });
});

describe("the line a person sees", () => {
  const held = [{ id: "11111111-2222-4333-8444-555555555555", business: "Shop 00" }];
  it("is the plain reason, with the lead to open and nothing to copy or mark sent", () => {
    expect(HELD_LINE).toBe("Held: this draft says a website was created and no sample is approved. Edit the sentence or ask the owner.");
    for (const html of [
      renderToStaticMarkup(createElement(SendPack, { pack: [], held, size: 10, me: "Olu", others: null, today: TODAY })),
      renderToStaticMarkup(createElement(WhatsAppPack, { checks: [], send: [], held, size: 20, today: TODAY })),
    ]) {
      expect(html).toContain("Held: this draft says a website was created");
      expect(html).toContain(`lead=${held[0].id}`);
      expect(html).not.toMatch(/OW27|\bflag/i);
      expect(html).not.toContain("Copy draft");
      expect(html).not.toContain("Copy message");
    }
  });
});
