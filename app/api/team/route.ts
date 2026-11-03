import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { addMember, removeMember } from "@/lib/team";

// POST {action: "add", email, name, role} | {action: "remove", userId}: the team, by Google address (lib/team.ts).
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("users.add");
  if ("res" in g) return g.res;
  const body = (await req.json().catch(() => ({}))) as { action?: string; email?: string; name?: string; role?: string; userId?: string };
  const by = { userId: g.who.userId, role: g.who.role };
  const d = await db();
  try {
    if (body.action === "add") {
      const r = await addMember(d, g.who.tenantId, { email: String(body.email ?? ""), name: String(body.name ?? ""), role: body.role === "manager" ? "manager" : "member" }, by);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    if (body.action === "remove") {
      const r = await removeMember(d, g.who.tenantId, String(body.userId ?? ""), by);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    return NextResponse.json({ ok: false, error: "action is add or remove" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, `team.${body.action}`) }, { status: 500 });
  }
}
