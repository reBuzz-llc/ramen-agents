import { NextResponse } from "next/server";
import { checkPatch, deletePackage, updatePackage } from "@/lib/assets";
import { db } from "@/lib/db";
import { displayName } from "@/lib/display-name";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";

// One package from the Packages page: PUT {fields: {the changed ones}, since: <its updatedAt as
// loaded>} changes only those fields, refused with 409 when someone saved it since; DELETE removes it. Owner and managers.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("assets.edit");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { fields?: unknown; since?: unknown } | null;
  const c = checkPatch(b?.fields);
  if (!c.ok) return NextResponse.json({ ok: false, error: c.message }, { status: 400 });
  try {
    const r = await updatePackage(await db(), g.who.tenantId, (await ctx.params).id, c.patch, displayName(g.who.name, g.who.email), typeof b?.since === "string" ? b.since : undefined);
    return r.ok ? NextResponse.json({ ok: true, package: r.package }) : NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "assets.package") }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("assets.edit");
  if ("res" in g) return g.res;
  const r = await deletePackage(await db(), g.who.tenantId, (await ctx.params).id).catch(() => ({ ok: false, message: "not deleted" }));
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: r.message }, { status: 404 });
}
