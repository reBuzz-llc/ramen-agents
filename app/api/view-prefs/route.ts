import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { DEFAULT_VIEW } from "@/lib/view-prefs";
import { getViewPrefs, setViewPrefs } from "@/lib/view-prefs-db";

// A person's own view of the lead drawer: GET answers it, POST saves a part of it
// ({show_empty}, {field_order}, {hidden_fields}) or {reset: true} for the default. Only ever the signed-in person's own.
export async function GET() {
  const g = await guard("clock.own");
  if ("res" in g) return g.res;
  try {
    return NextResponse.json({ ok: true, view: await getViewPrefs(await db(), g.who.tenantId, g.who.userId) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "view-prefs") }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("clock.own");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return NextResponse.json({ ok: false, error: "send {show_empty}, {field_order}, {hidden_fields} or {reset: true}" }, { status: 400 });
  const patch = b.reset === true ? DEFAULT_VIEW : Object.fromEntries(Object.entries(b).filter(([k]) => ["show_empty", "field_order", "hidden_fields"].includes(k)));
  try {
    return NextResponse.json({ ok: true, view: await setViewPrefs(await db(), g.who.tenantId, g.who.userId, patch) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "view-prefs") }, { status: 500 });
  }
}
