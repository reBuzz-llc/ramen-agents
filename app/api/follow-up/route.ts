import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { markFollowUp } from "@/lib/follow-up";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { displayName } from "@/lib/display-name";

// POST {id}: "Follow-up sent" on a lead the person followed up from their own mailbox: today and
// their name into follow_up_at / follow_up_by. Results go through PATCH /api/leads/{id} like the drawer's chips.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof b?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(b.id)) return NextResponse.json({ ok: false, error: "send {id}" }, { status: 400 });
  try {
    const r = await markFollowUp(await db(), g.who.tenantId, b.id, { userId: g.who.userId, name: displayName(g.who.name, g.who.email) });
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "follow-up") }, { status: 500 });
  }
}
