import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { defaultScopes, isScope, KEY_NAME, replaceKey } from "@/lib/api-keys";

// POST {name, scopes?}: mint a board API key from Settings > API keys (owner only). The token is in this answer and
// nowhere else; Peek keeps its SHA-256. The name's earlier live keys are revoked in the same step.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("keys.manage");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { name?: unknown; scopes?: unknown } | null;
  const name = String(b?.name ?? "").trim().toLowerCase();
  if (!KEY_NAME.test(name)) return NextResponse.json({ ok: false, error: "A name of 2 to 31 lowercase letters, digits or dashes, a letter first: engine, validator, backfill." }, { status: 400 });
  const asked = Array.isArray(b?.scopes) ? b.scopes : null;
  if (asked && !asked.every(isScope)) return NextResponse.json({ ok: false, error: "Unknown scope." }, { status: 400 });
  const scopes = asked && asked.length ? [...new Set(asked)] : defaultScopes(name);
  try {
    const k = await replaceKey(await db(), g.who.tenantId, name, scopes);
    return NextResponse.json({ ok: true, id: k.id, name, scopes, token: k.token, revoked: k.revoked }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "keys.mint") }, { status: 500 });
  }
}
