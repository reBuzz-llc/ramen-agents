import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { filesOfLead } from "@/lib/files";
import { flagsOf } from "@/lib/flags";
import { getLead, historyOf, writeLead } from "@/lib/leads";
import { sameOrigin } from "@/lib/same-origin";
import { displayName } from "@/lib/display-name";

// GET: one lead with its history, for the board page's drawer (the signed-in team; keys use /v1).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const d = await db();
  const { id } = await ctx.params;
  const [lead, history, flags, attachments] = await Promise.all([getLead(d, g.who.tenantId, { id }), historyOf(d, g.who.tenantId, id), flagsOf(d, g.who.tenantId, id), filesOfLead(d, g.who.tenantId, id)]);
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ lead, history, flags: flags ?? [], attachments }, { headers: { "Cache-Control": "no-store" } });
}

// PATCH {fields}: a person's edit or one-click step, written as that person into the lead's history (a person's change
// then wins over the bots: lib/leads.ts). Answers the lead as stored, its history, and what was refused.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { fields?: Record<string, unknown> } | null;
  if (!b?.fields || typeof b.fields !== "object") return NextResponse.json({ ok: false, error: "send {fields}" }, { status: 400 });
  const d = await db();
  const { id } = await ctx.params;
  try {
    const r = await writeLead(d, g.who.tenantId, { id }, b.fields, { kind: "person", name: displayName(g.who.name, g.who.email), userId: g.who.userId });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.message }, { status: r.code === "not_found" ? 404 : 400 });
    return NextResponse.json({ ok: true, lead: r.lead, written: r.written, refused: r.refused, changes: r.changes ?? [], history: await historyOf(d, g.who.tenantId, id) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "leads.edit") }, { status: 500 });
  }
}
