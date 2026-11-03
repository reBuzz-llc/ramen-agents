import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { addProject } from "@/lib/projects";
import { cleanNote, lastNotes, notesFor, postNote, teamNow } from "@/lib/shift-notes";
import { addUser, clockIn, clockOut, createTenant, shiftsSince, switchProject } from "@/lib/tenants";

const at = (hhmm: string) => new Date(`2026-10-14T${hhmm}:00Z`);

describe("Now doing… notes", () => {
  it("a note lands on the open shift and never changes it; none without a shift", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    expect((await postNote(db, tenant.id, owner.id, "hello", at("08:00"))).ok).toBe(false);
    await clockIn(db, tenant.id, owner.id, at("09:00"));
    await postNote(db, tenant.id, owner.id, "  starting   the Brooklyn list ", at("09:05"));
    const [s] = await shiftsSince(db, tenant.id, owner.id, at("00:00"));
    expect(s.endedAt).toBeNull(); // still the same open shift
    expect((await notesFor(db, tenant.id, [s.id])).map((n) => n.text)).toEqual(["starting the Brooklyn list"]);
    expect(cleanNote("x".repeat(400))).toHaveLength(280);
  });

  it("after a switch, the next note lands on the new shift; the last note per project is kept for prefill", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const p = await addProject(db, tenant.id, "Acme site");
    if (!p.ok) throw new Error(p.error);
    await clockIn(db, tenant.id, owner.id, at("09:00"));
    await postNote(db, tenant.id, owner.id, "inbox", at("09:01"));
    await switchProject(db, tenant.id, owner.id, p.project.id, at("10:00"));
    await postNote(db, tenant.id, owner.id, "homepage copy", at("10:01"));
    await clockOut(db, tenant.id, owner.id, at("11:00"));
    const shifts = (await shiftsSince(db, tenant.id, owner.id, at("00:00"))).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    const notes = await notesFor(db, tenant.id, shifts.map((s) => s.id));
    expect(notes.find((n) => n.text === "homepage copy")?.shiftId).toBe(shifts[1].id);
    expect(await lastNotes(db, tenant.id, owner.id)).toEqual({ "": "inbox", [p.project.id]: "homepage copy" });
  });

  it("Team now: who is clocked in, on what, with their latest note", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const ann = await addUser(db, tenant.id, "ann@acme.example", "Ann");
    const p = await addProject(db, tenant.id, "Brooklyn list");
    if (!p.ok) throw new Error(p.error);
    await clockIn(db, tenant.id, ann.id, at("09:00"), p.project.id);
    await postNote(db, tenant.id, ann.id, "first ten done", at("09:30"));
    await postNote(db, tenant.id, ann.id, "on a call", at("10:15"));
    await clockIn(db, tenant.id, owner.id, at("09:00"));
    await clockOut(db, tenant.id, owner.id, at("09:10")); // clocked out: not listed
    const now = await teamNow(db, tenant.id);
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({ name: "Ann", project: "Brooklyn list", note: "on a call" });
  });
});

describe("repeated submits", () => {
  it("four rapid submits of the same note make one; the same key twice makes one; a new text makes another", async () => {
    const { deleteNote } = await import("@/lib/shift-notes");
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const ann = await addUser(db, tenant.id, "ann@acme.example", "Ann");
    await clockIn(db, tenant.id, ann.id, at("21:00"));
    const r = await Promise.all([1, 2, 3, 4].map(() => postNote(db, tenant.id, ann.id, "content", at("21:07"))));
    expect(r.every((x) => x.ok)).toBe(true);
    const [s] = await shiftsSince(db, tenant.id, ann.id, at("00:00"));
    expect(await notesFor(db, tenant.id, [s.id])).toHaveLength(1);
    // a retry of one submission (same key) after the minute is still one note
    await postNote(db, tenant.id, ann.id, "homepage", at("21:10"), "key-abc-123");
    await postNote(db, tenant.id, ann.id, "homepage", at("21:30"), "key-abc-123");
    // the same words later, as a new submission, are a new note
    await postNote(db, tenant.id, ann.id, "content", at("21:20"));
    const notes = await notesFor(db, tenant.id, [s.id]);
    expect(notes.map((n) => n.text)).toEqual(["content", "homepage", "content"]);

    // delete: your own for ten minutes; after that a manager or the owner
    const [row] = await db.query.shiftNotes.findMany({ where: (n, { eq }) => eq(n.text, "homepage") });
    expect((await deleteNote(db, tenant.id, { userId: ann.id, role: "member" }, row.id, at("21:15"))).ok).toBe(true);
    const old = (await db.query.shiftNotes.findMany())[0];
    expect((await deleteNote(db, tenant.id, { userId: ann.id, role: "member" }, old.id, at("23:00"))).ok).toBe(false);
    expect((await deleteNote(db, tenant.id, { userId: owner.id, role: "owner" }, old.id, at("23:00"))).ok).toBe(true);
  });
});
