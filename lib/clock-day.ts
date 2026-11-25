// A person's day on the Clock, for the page's first paint and for /api/clock.
import { and, eq, gte } from "drizzle-orm";
import { cadenceFor, liveUpdate, updateWindows } from "./cadence";
import type { Db } from "./db";
import { gapNotes, type TenantSettings } from "./db/schema";
import { shiftEditsOf } from "./open-clock";
import { lastProject, projectName, projectsOf, recentProjects } from "./projects";
import { dayStartIn } from "./send-goals";
import { lastNotes, notesSince } from "./shift-notes";
import { forgottenShift, shiftsSince } from "./tenants";
import { day, minutesByProject } from "./timesheet";

// The day as the company reads it
const today = (settings: TenantSettings) => dayStartIn(new Date(), settings.timezone);

/** Today's shifts (with their notes) and gaps, the company's projects, today's minutes per project, the project to
 *  preselect (the one running, else the person's last choice) and the last note per project. Reads side by side. */
export async function clockDay(d: Db, tenantId: string, userId: string, settings: TenantSettings) {
  const since = today(settings);
  const [shifts, notes, list, last, recent, prefill, shiftNoteRows, forgotten, closedForYou] = await Promise.all([
    shiftsSince(d, tenantId, userId, since),
    d.select().from(gapNotes).where(and(eq(gapNotes.tenantId, tenantId), eq(gapNotes.userId, userId), gte(gapNotes.fromAt, since))),
    projectsOf(d, tenantId),
    lastProject(d, tenantId, userId),
    recentProjects(d, tenantId, userId),
    lastNotes(d, tenantId, userId),
    notesSince(d, tenantId, userId, since),
    forgottenShift(d, tenantId, userId, since),
    // A clock an owner or manager closed or corrected for this person, for 14 days
    shiftEditsOf(d, tenantId, userId, new Date(Date.now() - 14 * 86_400_000)),
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
    // A shift left open from an earlier day: the Clock asks when it ended before offering Clock in.
    forgotten: forgotten ? { id: forgotten.id, startedAt: forgotten.startedAt.toISOString(), projectId: forgotten.projectId ?? null } : null,
    closedForYou,
  };
}
