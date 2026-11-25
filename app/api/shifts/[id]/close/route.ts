import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { displayName } from "@/lib/display-name";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { ClockError, closeClockFor, correctClock } from "@/lib/open-clock";
import { sameOrigin } from "@/lib/same-origin";

// POST {action: "close" | "correct", at}: an owner, or a manager for a member, enters the real end of someone's forgotten
// clock, or corrects it. There is no default time and no automatic close. The person comes from the session.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("week.team");
  if ("res" in g) return g.res;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { action?: unknown; at?: unknown } | null;
  const actor = { userId: g.who.userId, name: displayName(g.who.name, g.who.email), role: g.who.role };
  try {
    const d = await db();
    if (b?.action === "close") await closeClockFor(d, g.who.tenantId, id, b.at, actor);
    else if (b?.action === "correct") await correctClock(d, g.who.tenantId, id, b.at, actor, g.who.settings);
    else return NextResponse.json({ ok: false, error: "action is close or correct" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ClockError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: publicReason(err, "shifts.close") }, { status: 500 });
  }
}
