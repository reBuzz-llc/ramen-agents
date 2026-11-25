import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { displayName } from "@/lib/display-name";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { approveAsk, AskError, clearBench, withdrawAsk } from "@/lib/owner-asks";
import { sameOrigin } from "@/lib/same-origin";
import { recordPress } from "@/lib/session-press";

// POST {action: "approve", id, textHash} | {action: "withdraw", id} | {action: "clear", id}: the owner's own press, from
// the signed-in session. The person comes from the session, never from the body. No key reaches this route.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("owner.answers");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown; textHash?: unknown } | null;
  if (typeof b?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(b.id)) return NextResponse.json({ ok: false, error: "send {action, id}" }, { status: 400 });
  const who = { userId: g.who.userId, name: displayName(g.who.name, g.who.email), role: g.who.role };
  try {
    const d = await db();
    if (b.action === "approve") await approveAsk(d, g.who.tenantId, b.id, b.textHash, who);
    else if (b.action === "withdraw") await withdrawAsk(d, g.who.tenantId, b.id, who);
    else if (b.action === "clear") await clearBench(d, g.who.tenantId, b.id, who);
    else return NextResponse.json({ ok: false, error: "action is approve, withdraw or clear" }, { status: 400 });
    await recordPress(d, g.who, b.action === "approve" ? "owner.approve" : b.action === "withdraw" ? "owner.withdraw" : "owner.clear", b.action === "clear" ? "billing_bench" : "owner_ask", b.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AskError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: publicReason(err, "approvals") }, { status: 500 });
  }
}
