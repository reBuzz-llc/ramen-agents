import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { me } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { textPdf } from "@/lib/pdf";
import { can } from "@/lib/roles";
import { canSeePay } from "@/lib/rates";
import { sameOrigin } from "@/lib/same-origin";
import { approve, statementFor } from "@/lib/statements";
import { hhmm } from "@/lib/timesheet";
import { displayName } from "@/lib/display-name";

const okWeek = (w: string) => /^\d{4}-\d{2}-\d{2}$/.test(w);

// GET ?user=&week=&format=pdf: the statement as a PDF. Your own, or anyone's for a manager or the owner.
export async function GET(req: Request) {
  const who = await me();
  if (!who) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const userId = q.get("user") ?? "";
  const week = q.get("week") ?? "";
  if (!okWeek(week)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const d = await db();
  const [person] = await d.select().from(users).where(and(eq(users.tenantId, who.tenantId), eq(users.id, userId)));
  const visible = person && canSeePay({ id: who.userId, role: who.role }, person);
  const s = visible ? await statementFor(d, who.tenantId, userId, week) : null;
  if (!person || !s) return NextResponse.json({ error: "not found" }, { status: 404 });
  const m = (n: number | null) => (n === null ? "owner sets the rate" : `${s.statement.currency} ${n.toFixed(2)}`);
  const pdf = textPdf([
    { text: `${who.tenantName}: weekly statement`, size: 16, bold: true },
    { text: `${displayName(person.name, person.email)}, week of ${week}` },
    { text: s.approved ? `Approved by ${s.approved.by} on ${s.approved.at.slice(0, 10)}` : "Draft: not yet approved" },
    { text: " " },
    { text: `Hours clocked: ${hhmm(s.week.minutes)}` },
    ...(s.statement.lines ?? []).map((l) => ({ text: `   ${l.project}, ${l.from === l.to ? l.from : `${l.from} to ${l.to}`}: ${l.hours.toFixed(2)} h x ${l.hourly === null ? "rate not set" : l.hourly.toFixed(2)} = ${m(l.base)}` })),
    { text: `Base (hours x hourly rate): ${m(s.statement.base)}` },
    { text: `Emails sent: ${s.week.sent}` },
    { text: `WhatsApp messages sent: ${s.week.whatsapp ?? 0}` },
    { text: `Replies ${s.week.replies}, meetings ${s.week.meetings}, clients ${s.week.clients}` },
    { text: `Outcome bonus: ${m(s.statement.bonus)}` },
    { text: `Tasks done: ${s.week.tasksDone}` },
    ...(s.days.length ? [{ text: " " }, { text: "Day by day", bold: true }] : []),
    ...s.days.flatMap((d) => [
      { text: `${d.day}: ${hhmm(d.minutes)}` },
      ...d.shifts.flatMap((sh) => [
        { text: `   ${new Date(sh.start).toTimeString().slice(0, 5)}-${sh.end ? new Date(sh.end).toTimeString().slice(0, 5) : "now"}  ${sh.project}  ${hhmm(sh.minutes)}${sh.updates ? `  ${sh.updates.met} of ${sh.updates.expected} updates` : ""}` },
        ...sh.notes.map((n) => ({ text: `      ${new Date(n.at).toTimeString().slice(0, 5)}  ${n.text}` })),
      ]),
    ]),
    { text: " " },
    { text: `Total: ${m(s.statement.total)}`, bold: true },
  ]);
  return new Response(pdf as BodyInit, {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="statement-${week}.pdf"` },
  });
}

// POST user, week: a manager or the owner approves and freezes someone else's statement.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const who = await me();
  if (!who || !can(who.role, "week.team")) return NextResponse.json({ error: "your role cannot approve" }, { status: 403 });
  const form = await req.formData();
  const userId = String(form.get("user") ?? "");
  const week = String(form.get("week") ?? "");
  if (!okWeek(week) || userId === who.userId) return NextResponse.json({ error: "you cannot approve your own statement" }, { status: 400 });
  const d = await db();
  const [person] = await d.select().from(users).where(and(eq(users.tenantId, who.tenantId), eq(users.id, userId)));
  if (!person || !canSeePay({ id: who.userId, role: who.role }, person)) return NextResponse.json({ error: "not found" }, { status: 404 });
  await approve(d, who.tenantId, userId, week, who.userId);
  return NextResponse.redirect(new URL(`/week/statement/${userId}?week=${week}`, req.url), 303);
}
