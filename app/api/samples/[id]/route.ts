import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { displayName } from "@/lib/display-name";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { deleteSample, reviewSample, SampleError, type Review } from "@/lib/samples";
import { recordPress } from "@/lib/session-press";

// POST {action: "approve" | "changes" | "takedown" | "hold" | "release", note?, version (approve: the version looked at)}: a person's
// decision on a sample. Hold keeps it off the web whatever its status; release lets it publish again.
// Approve, take down and reject (the lead leaves the Site Builder's queue, the optional reason is what it reads):
// anyone on the team (samples.review). Request changes: anyone working the leads, with a note the
// Site Builder reads on its next turn.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => null)) as { action?: string; note?: string; version?: unknown; asked?: unknown } | null;
  const action = (["approve", "changes", "takedown", "hold", "release", "reject"] as const).find((a) => a === b?.action) as Review | undefined;
  if (!action) return NextResponse.json({ ok: false, error: "action is approve, changes, takedown, hold, release or reject" }, { status: 400 });
  const g = await guard(action === "changes" ? "queue.work" : "samples.review");
  if ("res" in g) return g.res;
  const { id } = await ctx.params;
  // an Approve names the version the person looked at; a newer one arriving meanwhile is refused (409)
  const seen = Number.isInteger(b?.version) ? (b!.version as number) : undefined;
  if (action === "approve" && seen === undefined) return NextResponse.json({ ok: false, error: "say which version you approve (version)" }, { status: 400 });
  try {
    const d = await db();
    const sample = await reviewSample(d, g.who.tenantId, id, action, { name: displayName(g.who.name, g.who.email), userId: g.who.userId }, b?.note ?? "", undefined, seen, { asked: b?.asked === true });
    if (action === "approve" || action === "changes") await recordPress(d, g.who, action === "approve" ? "sample.approve" : "sample.request", "sample", id);
    return NextResponse.json({ ok: true, sample });
  } catch (err) {
    if (err instanceof SampleError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: publicReason(err, "samples.review") }, { status: 500 });
  }
}

// DELETE: the owner deletes a taken-down or rejected sample with all its versions and copied pictures;
// one audit line is kept and the lead stays out of the Site Builder's queue. The owner only.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("samples.review");
  if ("res" in g) return g.res;
  if (g.who.role !== "owner") return NextResponse.json({ ok: false, error: "only the owner deletes a sample" }, { status: 403 });
  const { id } = await ctx.params;
  try {
    const r = await deleteSample(await db(), g.who.tenantId, id, displayName(g.who.name, g.who.email));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    if (err instanceof SampleError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: publicReason(err, "samples.delete") }, { status: 500 });
  }
}
