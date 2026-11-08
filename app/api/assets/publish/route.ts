import { NextResponse } from "next/server";
import { publishPackages } from "@/lib/assets";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { displayName } from "@/lib/display-name";

// POST {ids: [...]} from the Asset page: publish these drafts, as the person who clicked. One
// package: the owner or a manager (its Publish button); several at once ("Publish all drafts"): the owner. A key never
// reaches this route (people's sessions only), and PUT /v1/assets/packages refuses to publish.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("assets.edit");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(b?.ids) ? b.ids.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
  if (!ids.length) return NextResponse.json({ ok: false, error: "pick at least one draft" }, { status: 400 });
  if (ids.length > 1 && g.who.role !== "owner") return NextResponse.json({ ok: false, error: "only the owner publishes several drafts at once" }, { status: 403 });
  try {
    const published = await publishPackages(await db(), g.who.tenantId, ids, displayName(g.who.name, g.who.email));
    return NextResponse.json({ ok: true, published });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "assets.publish") }, { status: 500 });
  }
}
