import { NextResponse } from "next/server";
import { addPackage } from "@/lib/assets";
import { db } from "@/lib/db";
import { displayName } from "@/lib/display-name";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";

// POST {fields: {name, price?, ...}}: one new package at the end of the list. Owner and managers.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("assets.edit");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { fields?: Record<string, unknown> } | null;
  try {
    const r = await addPackage(await db(), g.who.tenantId, { ...(b?.fields ?? {}), name: String(b?.fields?.name ?? "") } as never, displayName(g.who.name, g.who.email));
    return r.ok ? NextResponse.json({ ok: true, package: r.package }) : NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "assets.package") }, { status: 500 });
  }
}
