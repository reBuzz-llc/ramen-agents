// A statement counts its sends, results and tasks only inside its week, so an old week's outcome
// bonus never takes in later weeks. Invented people and leads; times are built on the machine's clock, so this holds in any zone.
import { describe, expect, it } from "vitest";
import { memoryDb, type Db } from "@/lib/db";
import { leadCells, leads, memberRates, statements, tasks } from "@/lib/db/schema";
import { approve, statementFor } from "@/lib/statements";
import { addUser, createTenant } from "@/lib/tenants";
import { weekStart } from "@/lib/week";

const WEEK = "2026-10-12"; // a Monday
const NEXT = "2026-10-19";
const at = (day: string, h = 10) => new Date(`${day}T${String(h).padStart(2, "0")}:00:00`);
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

async function team() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const ann = await addUser(db, tenant.id, "ann@acme.example", "Ann");
  await db.insert(memberRates).values({ tenantId: tenant.id, userId: ann.id, effectiveFrom: "2026-01-01", hourlyCents: 2000, outcomeBonusCents: 1000 });
  return { db, tenantId: tenant.id, ownerId: owner.id, annId: ann.id };
}

type Row = { result?: string; resultDate?: string; sentAt?: Date | null; whatsapp?: boolean; pressedAt?: Date };
async function lead(db: Db, tenantId: string, name: string, r: Row) {
  const [row] = await db
    .insert(leads)
    .values({ tenantId, business: name, emailStatus: r.whatsapp ? null : "Email Sent", whatsappStatus: r.whatsapp ? "WhatsApp msg sent" : null, sentBy: ["Ann"], sentAt: r.sentAt ?? null, result: r.result ?? null, resultDate: r.resultDate ?? null })
    .returning();
  if (r.pressedAt) await db.insert(leadCells).values({ tenantId, leadId: row.id, column: "result_date", new: r.resultDate, actorKind: "person", actorName: "Ann", at: r.pressedAt });
  return row;
}
const doneTask = (db: Db, tenantId: string, title: string, when: Date) => db.insert(tasks).values({ tenantId, title, status: "Done", assignees: ["Ann"], updatedAt: when });

describe("799: a statement counts inside its own week", () => {
  it("keeps a later week's sends, results and tasks out of a past week's bonus", async () => {
    const { db, tenantId, annId } = await team();
    await lead(db, tenantId, "In the week", { sentAt: at("2026-10-13"), result: "Replied", resultDate: "2026-10-13" });
    await lead(db, tenantId, "A later week", { sentAt: at("2026-10-21"), result: "Client", resultDate: "2026-10-21" });
    await lead(db, tenantId, "A later message", { whatsapp: true, sentAt: at("2026-10-22") });
    await doneTask(db, tenantId, "Done in the week", at("2026-10-14"));
    await doneTask(db, tenantId, "Done later", at("2026-10-23"));
    const s = await statementFor(db, tenantId, annId, WEEK);
    expect(s?.week).toMatchObject({ sent: 1, whatsapp: 0, replies: 1, meetings: 0, clients: 0 });
    expect(s?.statement.outcomes).toBe(1);
    expect(s?.statement.bonus).toBe(10);
    const later = await statementFor(db, tenantId, annId, NEXT);
    expect(later?.week).toMatchObject({ sent: 1, whatsapp: 1, replies: 1, meetings: 1, clients: 1 });
    expect(later?.statement.outcomes).toBe(3);
  });

  it("still counts the current week up to now", async () => {
    const { db, tenantId, annId } = await team();
    const now = new Date(Date.now() - 1000);
    await lead(db, tenantId, "Just now", { sentAt: now, result: "Meeting", resultDate: utcDay(now), pressedAt: now });
    await doneTask(db, tenantId, "Just done", now);
    const s = await statementFor(db, tenantId, annId, weekStart(now));
    expect(s?.week).toMatchObject({ sent: 1, replies: 1, meetings: 1 });
    expect(s?.statement.outcomes).toBe(2);
  });

  for (const [first, second, why] of [[WEEK, NEXT, "an ordinary week"], ["2026-10-26", "2026-11-02", "a week where some zones change their clocks"]])
    it(`puts an item exactly on the boundary in one week only (${why})`, async () => {
      const { db, tenantId, annId } = await team();
      const edge = at(second, 0);
      const before = new Date(edge.getTime() - 1);
      await lead(db, tenantId, "Pressed on the edge", { sentAt: edge, result: "Replied", resultDate: utcDay(edge), pressedAt: edge });
      await lead(db, tenantId, "Pressed just before", { sentAt: before, result: "Replied", resultDate: utcDay(before), pressedAt: before });
      const lastDay = new Date(edge);
      lastDay.setDate(lastDay.getDate() - 1);
      const day = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
      await lead(db, tenantId, "Imported, last day", { result: "Replied", resultDate: day });
      await lead(db, tenantId, "Imported, first day", { result: "Replied", resultDate: second });
      await doneTask(db, tenantId, "Done on the edge", edge);
      await doneTask(db, tenantId, "Done just before", before);
      const a = await statementFor(db, tenantId, annId, first);
      const b = await statementFor(db, tenantId, annId, second);
      expect(a?.week).toMatchObject({ sent: 2, replies: 2 });
      expect(b?.week).toMatchObject({ sent: 2, replies: 2 });
    });

  it("never recomputes an approved statement", async () => {
    const { db, tenantId, annId, ownerId } = await team();
    await lead(db, tenantId, "In the week", { sentAt: at("2026-10-13"), result: "Replied", resultDate: "2026-10-13" });
    const approved = await approve(db, tenantId, annId, WEEK, ownerId);
    const [stored] = await db.select().from(statements);
    await lead(db, tenantId, "Added after approval", { sentAt: at("2026-10-14"), result: "Client", resultDate: "2026-10-14" });
    const again = await statementFor(db, tenantId, annId, WEEK);
    expect(again?.week).toEqual(approved?.week);
    expect(again?.statement).toEqual(approved?.statement);
    expect(again?.statement.outcomes).toBe(1);
    const [still] = await db.select().from(statements);
    expect(still.data).toEqual(stored.data);
  });
});
