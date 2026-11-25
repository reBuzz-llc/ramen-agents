import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gapNotes, type TenantSettings } from "@/lib/db/schema";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { addProject, projectsOf, setShiftProject, usableProject } from "@/lib/projects";
import { cleanNote, deleteNote, postNote } from "@/lib/shift-notes";
import { clockIn, clockOut, closeForgotten, switchProject } from "@/lib/tenants";
import { clockDay } from "@/lib/clock-day";
import { dayStartIn } from "@/lib/send-goals";

// the day as the company reads it
const today = (settings: TenantSettings) => dayStartIn(new Date(), settings.timezone);

// GET: today's shifts, total and gaps. Only the person's own day.
export async function GET() {
  const g = await guard("clock.own");
  if ("res" in g) return g.res;
  return NextResponse.json({ ...(await clockDay(await db(), g.who.tenantId, g.who.userId, g.who.settings)), canDeleteAny: g.who.role !== "member" });
}

// POST {action: "in" | "switch" | "out" | "note", projectId?, newProject?, note?, from?, to?}: clock in to a project
// (null is General), switch project mid-day (closes the shift, opens another), clock out, or note a gap in the day.
// {action: "closeForgotten", shiftId, at, note?}: close one's own shift left open from an earlier day at the time one stopped.
// `newProject` (a name) creates the project first, so anyone can start on a project that is not listed yet in one step.
// `note` on in or switch posts "what I'm working on" on the new shift; action "now" posts a note on the running shift.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const g = await guard("clock.own");
  if ("res" in g) return g.res;
  const body = (await req.json().catch(() => ({}))) as { action?: string; shiftId?: string; projectId?: string | null; newProject?: string; note?: string; text?: string; noteId?: string; from?: string; to?: string; at?: string };
  const key = req.headers.get("idempotency-key");
  const d = await db();
  const { tenantId, userId } = g.who;
  if (body.action === "in" || body.action === "switch") {
    if (body.newProject) {
      const made = await addProject(d, tenantId, body.newProject, "", userId);
      // Someone made the same name a moment ago: use theirs.
      body.projectId = made.ok ? made.project.id : (await projectsOf(d, tenantId)).find((p) => p.name.toLowerCase() === body.newProject!.trim().toLowerCase() && p.active)?.id;
      if (!body.projectId) return NextResponse.json({ error: made.ok ? "Could not create that project." : made.error }, { status: 400 });
    }
    const projectId = await usableProject(d, tenantId, body.projectId);
    if (projectId === undefined) return NextResponse.json({ error: "That project is not open for time any more. Pick another." }, { status: 400 });
    const r = body.action === "in" ? await clockIn(d, tenantId, userId, new Date(), projectId) : await switchProject(d, tenantId, userId, projectId);
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
    if (cleanNote(body.text)) await postNote(d, tenantId, userId, body.text, new Date(), key);
  } else if (body.action === "now") {
    // The same submission sent twice (Enter pressed again, a retry) carries the same key: one note, not two.
    const r = await postNote(d, tenantId, userId, body.text, new Date(), key);
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  } else if (body.action === "deleteNote") {
    const r = await deleteNote(d, tenantId, { userId, role: g.who.role }, String(body.noteId ?? ""));
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 403 });
  } else if (body.action === "out") {
    const r = await clockOut(d, tenantId, userId, new Date(), String(body.note ?? "").slice(0, 500));
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  } else if (body.action === "closeForgotten") {
    // the person's own shift left open from an earlier day, closed at the time they stopped
    const r = await closeForgotten(d, tenantId, userId, String(body.shiftId ?? ""), new Date(String(body.at ?? "")), String(body.note ?? "").trim());
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
  } else if (body.action === "shiftProject") {
    const projectId = await usableProject(d, tenantId, body.projectId);
    if (projectId === undefined) return NextResponse.json({ error: "That project is not open for time any more. Pick another." }, { status: 400 });
    const r = await setShiftProject(d, tenantId, userId, String(body.shiftId ?? ""), projectId, today(g.who.settings));
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
  } else if (body.action === "note") {
    const from = new Date(String(body.from));
    const to = new Date(String(body.to));
    const note = String(body.note ?? "").trim().slice(0, 300);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || !note) {
      return NextResponse.json({ error: "a gap note needs from, to and a note" }, { status: 400 });
    }
    await d.delete(gapNotes).where(and(eq(gapNotes.tenantId, tenantId), eq(gapNotes.userId, userId), eq(gapNotes.fromAt, from), eq(gapNotes.toAt, to)));
    await d.insert(gapNotes).values({ tenantId, userId, fromAt: from, toAt: to, note });
  } else {
    return NextResponse.json({ error: "action must be in, switch, now, deleteNote, out, closeForgotten, shiftProject or note" }, { status: 400 });
  }
  return NextResponse.json({ ...(await clockDay(d, tenantId, userId, g.who.settings)), canDeleteAny: g.who.role !== "member" });
}
