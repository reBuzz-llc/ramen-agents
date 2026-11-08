import { NextResponse } from "next/server";
import { publicReason } from "@/lib/errors";
import { db } from "@/lib/db";
import { guard } from "@/lib/guard";
import { claimsOf, closeClaim, holderOf } from "@/lib/claims";
import { peekTasksOf, type TaskRow } from "@/lib/queue";
import { leadQueue, markLead, sentSinceOnPeek, STATUS_SENT, WRITABLE } from "@/lib/lead-queue";
import { users } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { listTasks, openTaskFlags } from "@/lib/tasks";
import { sameOrigin } from "@/lib/same-origin";
import { recordOutcome } from "@/lib/tenants";
import { startDayOf, weekStart } from "@/lib/week";
import { displayName } from "@/lib/display-name";

// GET: the company's queue (drafts to review, emails to send, open team tasks), best Lead score first, and this week's
// sent count against the key result. The leads come from Peek's own board, the same rows and
// claims as Leads → Send next; nothing is read from Notion.
export async function GET() {
  const started = Date.now();
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const d = await db();
  try {
    // Three independent reads at once (one round trip of waiting, not three); the person, the company's settings and
    // the notice state came with the sign-in check. The task board is optional: when it fails, the leads still show.
    // The leads read is optional too: when it fails, its reason shows on the lead tabs and the team's tasks still show.
    const from = weekStart(new Date(), startDayOf(g.who.settings));
    const [{ queue, sentThisWeek, leadsReason }, taken, taskResult] = await Promise.all([
      Promise.all([leadQueue(d, g.who.tenantId), sentSinceOnPeek(d, g.who.tenantId, from)]).then(
        ([queue, sentThisWeek]) => ({ queue, sentThisWeek, leadsReason: "" }),
        (err) => ({ queue: [] as Awaited<ReturnType<typeof leadQueue>>, sentThisWeek: 0, leadsReason: publicReason(err, "queue.read") }),
      ),
      claimsOf(d, g.who.tenantId),
      teamTasks(d, g.who).then(
        (tasks) => ({ tasks, reason: "" }),
        (err) => ({ tasks: [] as TaskRow[], reason: publicReason(err, "queue.tasks") }),
      ),
    ]);
    const { tasks, reason: tasksReason } = taskResult;
    const rows = queue.map((r) => {
      const c = taken.get(r.pageId);
      return { ...r, takenBy: c ? { name: c.name, mine: c.userId === g.who.userId, at: c.at.toISOString() } : null };
    });
    // Server-Timing: the browser's network panel shows how long the server spent (the budget is 600 ms warm).
    const people = tasks.some((t) => t.source === "peek")
      ? (await d.select({ name: users.name, email: users.email }).from(users).where(and(eq(users.tenantId, g.who.tenantId), eq(users.active, true)))).map((u) => displayName(u.name, u.email)).sort()
      : [];
    return NextResponse.json({ ok: true, rows, leadsReason, people, canRelease: g.who.role !== "member", tasks, tasksReason, sentThisWeek, target: g.who.settings.keyResults?.sent ?? null }, { headers: { "server-timing": `app;dur=${Date.now() - started}` } });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: publicReason(err, "queue.read"), rows: [] });
  }
}

/** The team's tasks, Peek's own. */
async function teamTasks(d: Awaited<ReturnType<typeof db>>, who: { tenantId: string; userId: string; name: string; email: string }): Promise<TaskRow[]> {
  const all: Record<string, unknown>[] = [];
  for (let since = 0, i = 0; i < 20; i++) {
    const page = await listTasks(d, who.tenantId, { since, limit: 500 });
    all.push(...page.tasks);
    if (!page.more) break;
    since = page.next;
  }
  const [taken, flags] = await Promise.all([claimsOf(d, who.tenantId), openTaskFlags(d, who.tenantId)]);
  return peekTasksOf(all, who, taken, flags);
}

// POST {pageId, status}: a person marks a lead they accepted reviewed or sent, after doing it themselves. Written on
// Peek's board as that person, the same step as the drawer and Send next (lib/lead-queue.ts); a lead nobody accepted,
// or someone else accepted, is refused.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const body = (await req.json().catch(() => ({}))) as { pageId?: string; status?: string };
  const status = String(body.status ?? "");
  if (typeof body.pageId !== "string" || !(WRITABLE as readonly string[]).includes(status)) {
    return NextResponse.json({ error: `status must be one of: ${WRITABLE.join(", ")}` }, { status: 400 });
  }
  const d = await db();
  const holder = await holderOf(d, g.who.tenantId, body.pageId);
  if (!holder) return NextResponse.json({ ok: false, error: "Accept it first." }, { status: 409 });
  if (holder.userId !== g.who.userId) return NextResponse.json({ ok: false, error: `${holder.name} accepted this one.` }, { status: 409 });
  try {
    const r = await markLead(d, g.who.tenantId, body.pageId, status as (typeof WRITABLE)[number], { kind: "person", name: displayName(g.who.name, g.who.email), userId: g.who.userId });
    if (r.ok) await recordOutcome(d, g.who.tenantId, g.who.userId, body.pageId, status === STATUS_SENT ? "sent" : "reviewed");
    if (r.ok && status === STATUS_SENT) await closeClaim(d, g.who.tenantId, body.pageId);
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "queue.write") }, { status: 502 });
  }
}
