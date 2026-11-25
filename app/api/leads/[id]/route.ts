import { NextResponse } from "next/server";
import { sessionHint } from "@/lib/auth";
import { holderOf } from "@/lib/claims";
import { readsWith } from "@/lib/session-hint";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { filesOfLead } from "@/lib/files";
import { sendLogOf } from "@/lib/lead-sends";
import { getLead, historyOf, leadSaveWarning, writeLead } from "@/lib/leads";
import { CHECKED } from "@/lib/pain-point-check";
import { readRich, richFor, richRows, saveRich } from "@/lib/rich-text-db";
import { sameOrigin } from "@/lib/same-origin";
import { displayName } from "@/lib/display-name";

// GET: one lead with its history, for the board page's drawer (the signed-in team; keys use /v1).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const d = await db();
  const { id } = await ctx.params;
  // read alongside the sign-in check; nothing is answered unless the check passes
  let refused: NextResponse | undefined;
  const got = await readsWith(
    await sessionHint(),
    async () => {
      const g = await guard("queue.work");
      if ("res" in g) refused = g.res;
      return "res" in g ? null : g.who;
    },
    ({ tenantId }) => Promise.all([getLead(d, tenantId, { id }), historyOf(d, tenantId, id), filesOfLead(d, tenantId, id), sendLogOf(d, tenantId, id), holderOf(d, tenantId, id), richRows(d, tenantId, id).catch(() => [])]),
  );
  if (!got) return refused ?? NextResponse.json({ error: "sign in first" }, { status: 401 });
  const [lead, history, attachments, sendLog, taken, formatted] = got.data;
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ lead, history, attachments, sendLog, holder: taken ? { userId: taken.userId, name: taken.name } : null, rich: richFor(formatted, lead as Record<string, unknown>) }, { headers: { "Cache-Control": "no-store" } });
}

// PATCH {fields}: a person's edit or one-click step, written as that person into the lead's history (a person's change
// then wins over the bots: lib/leads.ts). Answers the lead as stored, its history, and what was refused.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { fields?: Record<string, unknown>; confirmed?: unknown; rich?: unknown } | null;
  if (!b?.fields || typeof b.fields !== "object") return NextResponse.json({ ok: false, error: "send {fields}" }, { status: 400 });
  // the formatted copy of a pasted Google Doc, cleaned here whatever the browser sent
  const formatted = readRich(b.rich);
  if (!formatted.ok) return NextResponse.json({ ok: false, error: formatted.error }, { status: 400 });
  const d = await db();
  const { id } = await ctx.params;
  try {
    // a pain point or draft that names another lead's business or carries a research note is saved only
    // once the person confirms with Save anyway; never a block, and the person's cell wins
    if (b.confirmed !== true && Object.keys(CHECKED).some((k) => typeof b.fields![k] === "string" && (b.fields![k] as string).trim())) {
      const warn = await leadSaveWarning(d, g.who.tenantId, id, b.fields);
      if (warn) return NextResponse.json({ ok: false, warn }, { status: 409 });
    }
    const r = await writeLead(d, g.who.tenantId, { id }, b.fields, { kind: "person", name: displayName(g.who.name, g.who.email), userId: g.who.userId });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.message }, { status: r.code === "not_found" ? 404 : 400 });
    // the text is saved by now: a formatting failure is reported and never undoes it
    const rich = Object.keys(formatted.wanted).length
      ? await saveRich(d, g.who.tenantId, id, g.who.userId, formatted.wanted, b.fields, r.lead as Record<string, unknown>, (r.refused ?? []).map((x) => x.field)).catch(() => null)
      : undefined;
    return NextResponse.json({ ok: true, rich, lead: r.lead, written: r.written, refused: r.refused, changes: r.changes ?? [], history: await historyOf(d, g.who.tenantId, id), sendLog: await sendLogOf(d, g.who.tenantId, id) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "leads.edit") }, { status: 500 });
  }
}
