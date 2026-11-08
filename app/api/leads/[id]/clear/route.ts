import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { CLEARABLE, clearStatus, historyOf } from "@/lib/leads";
import { sameOrigin } from "@/lib/same-origin";
import { displayName } from "@/lib/display-name";

// POST {field: "email_status" | "whatsapp_status" | "result"}: the × on a status chip. Answers the lead and its history.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { field?: string } | null;
  const field = CLEARABLE.find((f) => f === b?.field);
  if (!field) return NextResponse.json({ ok: false, error: "field is email_status, whatsapp_status or result" }, { status: 400 });
  const { id } = await ctx.params;
  const d = await db();
  try {
    const r = await clearStatus(d, g.who.tenantId, id, field, { kind: "person", name: displayName(g.who.name, g.who.email), userId: g.who.userId });
    if (!r.ok) return NextResponse.json(r, { status: 409 });
    return NextResponse.json({ ...r, history: await historyOf(d, g.who.tenantId, id) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "leads.clear") }, { status: 500 });
  }
}
