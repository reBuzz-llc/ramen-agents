import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { revokeKey } from "@/lib/api-keys";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DELETE: revoke one of the company's keys (owner only). The agent using it is refused from its next call on.
export async function DELETE(req: Request, ctx: RouteContext<"/api/keys/[id]">) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("keys.manage");
  if ("res" in g) return g.res;
  const { id } = await ctx.params;
  if (!UUID.test(id) || !(await revokeKey(await db(), g.who.tenantId, id))) return NextResponse.json({ ok: false, error: "No live key with that id in your company." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
