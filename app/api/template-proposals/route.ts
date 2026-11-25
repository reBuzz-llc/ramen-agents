import { NextResponse } from "next/server";
import { displayName } from "@/lib/display-name";
import { db } from "@/lib/db";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { answerOnPeek, offerFor, ProposalError } from "@/lib/template-proposals";

// The prompt after a person saves a draft. GET ?lead=<id>&edit=<lead_cells id>:
// {offer: {edit_id, channel, group, count, words} | null}, only for the person's own save that is more than a small fix.
// POST {lead, edit, answer: "yes" | "no"}: Yes makes it the group's template for that channel, "no" keeps it to this lead;
// the first answer wins (409 when the edit was answered).
export async function GET(req: Request) {
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const p = new URL(req.url).searchParams;
  const edit = Number(p.get("edit"));
  if (!p.get("lead") || !Number.isInteger(edit)) return NextResponse.json({ offer: null });
  return NextResponse.json({ offer: await offerFor(await db(), g.who.tenantId, p.get("lead")!, edit, g.who.userId) });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { lead?: unknown; edit?: unknown; answer?: unknown } | null;
  const edit = Number(b?.edit);
  if (typeof b?.lead !== "string" || !Number.isInteger(edit) || (b.answer !== "yes" && b.answer !== "no")) return NextResponse.json({ ok: false, error: "send {lead, edit, answer: yes | no}" }, { status: 400 });
  const d = await db();
  // only the person who made the save answers for it
  if (!(await offerFor(d, g.who.tenantId, b.lead, edit, g.who.userId))) return NextResponse.json({ ok: false, error: "nothing to answer for that save" }, { status: 409 });
  try {
    return NextResponse.json({ ok: true, proposal: await answerOnPeek(d, g.who.tenantId, b.lead, edit, b.answer === "yes", displayName(g.who.name, g.who.email)) });
  } catch (err) {
    if (err instanceof ProposalError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    throw err;
  }
}
