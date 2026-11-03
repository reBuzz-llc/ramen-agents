// The project log's day and its PDF: shared by the page and the export route.
import { and, eq } from "drizzle-orm";
import type { Db } from "./db";
import { projects } from "./db/schema";
import { textPdf } from "./pdf";
import { GENERAL } from "./project-picker";
import { projectLog } from "./shift-notes";
import { hhmm } from "./timesheet";

/** "general" or a project of this company; null when it is neither. */
export async function logProject(db: Db, tenantId: string, id: string) {
  if (id === "general") return { id: null, name: GENERAL, client: "" };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [p] = await db.select({ id: projects.id, name: projects.name, client: projects.client }).from(projects).where(and(eq(projects.tenantId, tenantId), eq(projects.id, id)));
  return p ?? null;
}

/** A YYYY-MM-DD day (default today, local time) and its bounds. */
export function dayBounds(raw: unknown) {
  const today = new Date();
  const fallback = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const day = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(new Date(`${raw}T00:00:00`).getTime()) ? raw : fallback;
  const from = new Date(`${day}T00:00:00`);
  return { day, from, to: new Date(from.getTime() + 86400e3) };
}

export const shiftDay = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export async function logOf(db: Db, tenantId: string, project: { id: string | null }, day: { from: Date; to: Date }) {
  return projectLog(db, tenantId, project.id, day.from, day.to);
}

const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** The day's log as a PDF a client can read: project, day, hours, then each update in order. Text only. */
export function logPdf(project: { name: string; client: string }, company: string, day: string, log: Awaited<ReturnType<typeof projectLog>>) {
  return textPdf([
    { text: `${project.name}${project.client ? ` for ${project.client}` : ""}`, size: 16, bold: true },
    { text: `Work log, ${day}. ${company}.` },
    { text: `Time on this project: ${hhmm(log.minutes)}. Updates: ${log.lines.length}.` },
    { text: " " },
    ...(log.lines.length ? log.lines.map((l) => ({ text: `${time(l.at)}  ${l.name}: ${l.text}` })) : [{ text: "No updates were posted on this day." }]),
  ]);
}
