import { NextResponse } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { gapNotes } from "@/lib/db/schema";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { addProject, lastProject, projectName, projectsOf, recentProjects, setShiftProject, usableProject } from "@/lib/projects";
import { cleanNote, deleteNote, lastNotes, notesSince, postNote } from "@/lib/shift-notes";
import { clockIn, clockOut, shiftsSince, switchProject } from "@/lib/tenants";
import { day, minutesByProject } from "@/lib/timesheet";
import { cadenceFor, liveUpdate, updateWindows } from "@/lib/cadence";
import type { TenantSettings } from "@/lib/db/schema";

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Today's shifts (with their notes) and gaps, the company's projects, today's minutes per project, the project to
 *  preselect (the one running, else the person's last choice) and the last note per project. Reads side by side. */
async function todayOf(tenantId: string, userId: string, settings: TenantSettings) {
  const d = await db();
  const since = today();
  const [shifts, notes, list, last, recent, prefill, shiftNoteRows] = await Promise.all([
    shiftsSince(d, tenantId, userId, since),
    d.select().from(gapNotes).where(and(eq(gapNotes.tenantId, tenantId), eq(gapNotes.userId, userId), gte(gapNotes.fromAt, since))),
    projectsOf(d, tenantId),
    lastProject(d, tenantId, userId),
    recentProjects(d, tenantId, userId),
    lastNotes(d, tenantId, userId),
    notesSince(d, tenantId, userId, since),
  ]);
  const byProject = [...minutesByProject(shifts)].map(([id, minutes]) => ({ id, name: projectName(list, id), minutes })).sort((a, b) => b.minutes - a.minutes);
  // All projects (archived ones still name past shifts); the picker shows only active ones.
  const theDay = day(shifts, notes);
  // Update cadence: each shift's windows met so far, and the live state of the running one (due, posted, overdue).
  const cadenceOf = (projectId: string | null) => cadenceFor(projectId ? (list.find((p) => p.id === projectId) ?? null) : null, settings);
  const withNotes = theDay.shifts.map((s) => {
    const own = shiftNoteRows.filter((n) => n.shiftId === s.id);
    const w = updateWindows(s, own, cadenceOf(s.projectId ?? null));
    return { ...s, notes: own.map((n) => ({ id: n.id, at: n.at, text: n.text })), updates: { expected: w.expected, met: w.met } };
  });
  const open = withNotes.find((s) => s.open);
  return {
    ...theDay,
    shifts: withNotes,
    update: open ? liveUpdate(open, shiftNoteRows.filter((n) => n.shiftId === open.id), cadenceOf(open.projectId ?? null)) : null,
    projects: list,
    recent,
    byProject,
    lastProjectId: last,
    // The last note per project ("" is General), to prefill "What will you work on?".
    lastNotes: prefill,
  };
}

// GET: today's shifts, total and gaps. Only the person's own day.
export async function GET() {
  const g = await guard("clock.own");
  if ("res" in g) return g.res;
  return NextResponse.json({ ...(await todayOf(g.who.tenantId, g.who.userId, g.who.settings)), canDeleteAny: g.who.role !== "member" });
}

// POST {action: "in" | "switch" | "out" | "note", projectId?, newProject?, note?, from?, to?}: clock in to a project
// (null is General), switch project mid-day (closes the shift, opens another), clock out, or note a gap in the day.
// `newProject` (a name) creates the project first, so anyone can start on a project that is not listed yet in one step.
// `note` on in or switch posts "what I'm working on" on the new shift; action "now" posts a note on the running shift.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const g = await guard("clock.own");
  if ("res" in g) return g.res;
  const body = (await req.json().catch(() => ({}))) as { action?: string; shiftId?: string; projectId?: string | null; newProject?: string; note?: string; text?: string; noteId?: string; from?: string; to?: string };
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
  } else if (body.action === "shiftProject") {
    const projectId = await usableProject(d, tenantId, body.projectId);
    if (projectId === undefined) return NextResponse.json({ error: "That project is not open for time any more. Pick another." }, { status: 400 });
    const r = await setShiftProject(d, tenantId, userId, String(body.shiftId ?? ""), projectId, today());
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
    return NextResponse.json({ error: "action must be in, switch, now, deleteNote, out, shiftProject or note" }, { status: 400 });
  }
  return NextResponse.json({ ...(await todayOf(tenantId, userId, g.who.settings)), canDeleteAny: g.who.role !== "member" });
}
