import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { db } from "@/lib/db";
import { issueCode, localMode } from "@/lib/local-codes";
import { sameOrigin } from "@/lib/same-origin";

// POST {userId}: a new local sign-in code for that person (owner and managers who manage people), shown once.
// Local mode only.
export async function POST(req: Request) {
  if (!localMode()) return NextResponse.json({ ok: false, error: "not in local mode" }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("users.manage");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { userId?: unknown } | null;
  const userId = typeof b?.userId === "string" ? b.userId : "";
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return NextResponse.json({ ok: false, error: "no such person" }, { status: 400 });
  const r = await issueCode(await db(), g.who.tenantId, userId, g.who.name || g.who.email);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 404 });
  return NextResponse.json({ ok: true, code: r.code, expiresAt: r.expiresAt.toISOString() }, { headers: { "cache-control": "no-store" } });
}
