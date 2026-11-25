import { NextResponse } from "next/server";
import { sessionHint } from "@/lib/auth";
import { db } from "@/lib/db";
import { displayName, namesOf } from "@/lib/display-name";
import { publicReason } from "@/lib/errors";
import { followUpCount, followUpsDue, markFollowUp } from "@/lib/follow-up";
import { guard } from "@/lib/guard";
import { can } from "@/lib/roles";
import { sameOrigin } from "@/lib/same-origin";
import { readsWith } from "@/lib/session-hint";
import { todayOf } from "@/lib/send-goals-db";
import { missingAgent, teamAgents } from "@/lib/agent-presence";

// GET ?count=1: how many follow-ups are due for this person (the tab and the Leads link). GET ?who=mine|all: the list and the day's
// counts; everyone's is for owners and managers.
// The count is asked by every page, so it is read beside the sign-in check, in one trip to the database. The names it was read
// with are compared with the person the check found; on any difference it is read again. Nothing is answered unless the check passes.
const namesSeen = new Map<string, string[]>();
async function countAnswer(): Promise<NextResponse> {
  const d = await db();
  let refused: NextResponse | undefined;
  let used: string[] | undefined;
  const got = await readsWith(
    await sessionHint(),
    async () => {
      const g = await guard("queue.work");
      if ("res" in g) refused = g.res;
      return "res" in g ? null : g.who;
    },
    async ({ userId, tenantId }) => {
      used = namesSeen.get(userId);
      return used ? followUpCount(d, tenantId, used) : null;
    },
  );
  if (!got) return refused ?? NextResponse.json({ error: "sign in first" }, { status: 401 });
  const names = namesOf(got.who.name, got.who.email);
  if (namesSeen.size > 500) namesSeen.clear();
  namesSeen.set(got.who.userId, names);
  const same = got.data !== null && used?.join("\n") === names.join("\n");
  return NextResponse.json({ count: same ? got.data : await followUpCount(d, got.who.tenantId, names) }, { headers: { "cache-control": "private, no-store" } });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (q.get("count") === "1") {
    try {
      return await countAnswer();
    } catch (err) {
      return NextResponse.json({ error: publicReason(err, "follow-up") }, { status: 500 });
    }
  }
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const canAll = can(g.who.role, "week.team");
  const who = q.get("who") === "all" && canAll ? null : namesOf(g.who.name, g.who.email);
  const headers = { "cache-control": "private, no-store" };
  try {
    const d = await db();
    const [rows, today, agents] = await Promise.all([followUpsDue(d, g.who.tenantId, who), todayOf(d, g.who.tenantId, g.who.userId, new Date(), g.who.settings), teamAgents(d, g.who.tenantId).catch(() => null)]);
    // a team without an Outreach Writer: the view says where the drafts come from (lib/agent-presence.ts)
    return NextResponse.json({ rows, today, canAll, scope: who === null ? "all" : "mine", missing: missingAgent(agents, "Outreach Writer") }, { headers });
  } catch (err) {
    return NextResponse.json({ error: publicReason(err, "follow-up") }, { status: 500 });
  }
}

// POST {id, step?, channel?}: "Mark sent" on a follow-up the person sent from their own mailbox or WhatsApp:
// the step, today and their name. Results go through PATCH /api/leads/{id} like the drawer's chips.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { id?: unknown; step?: unknown; channel?: unknown } | null;
  if (typeof b?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(b.id)) return NextResponse.json({ ok: false, error: "send {id}" }, { status: 400 });
  try {
    const r = await markFollowUp(await db(), g.who.tenantId, b.id, { userId: g.who.userId, name: displayName(g.who.name, g.who.email) }, new Date(), { step: b.step, channel: b.channel });
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "follow-up") }, { status: 500 });
  }
}
