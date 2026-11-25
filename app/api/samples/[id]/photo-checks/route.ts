import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { displayName } from "@/lib/display-name";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { can } from "@/lib/roles";
import { sameOrigin } from "@/lib/same-origin";
import { recordPress } from "@/lib/session-press";
import { rejectPhoto, restorePhotoOriginal, SampleError, sendBackRejected, setPhotoChecks, setPhotoDish } from "@/lib/samples";

// POST, anyone on the team (samples.review). One of:
//   {base, checks}: Accept stores all four on the photo's own entry, with when and no name; who approved stays in reviewed_by. It
//     needs no full-size look first: a photo can be accepted straight from the card
//   {base, dish}: what the photo shows: one of the lead's own items, a name the person typed, or null for none of these
//   {base, reject: true, note?}: Reject, with the optional "What is wrong?"
//   {base, restore: true}: an owner or a manager puts a colour-graded photo's original back
//   {sendBack: true, version}: files the rejected photos and their notes as a change request
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("samples.review");
  if ("res" in g) return g.res;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "no such sample" }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { base?: unknown; checks?: unknown; reject?: unknown; note?: unknown; dish?: unknown; restore?: unknown; sendBack?: unknown; version?: unknown } | null;
  const version = Number.isInteger(b?.version) ? (b!.version as number) : null;
  try {
    const d = await db();
    if (b?.sendBack === true) {
      if (version === null) return NextResponse.json({ ok: false, error: "say which version you looked at (version)" }, { status: 400 });
      const sent = await sendBackRejected(d, g.who.tenantId, id, { name: displayName(g.who.name, g.who.email), userId: g.who.userId }, version);
      await recordPress(d, g.who, "sample.request", "sample", id);
      return NextResponse.json({ ok: true, ...sent });
    }
    if (typeof b?.base !== "string" || !b.base) return NextResponse.json({ ok: false, error: "say which photo (base)" }, { status: 400 });
    if (b.restore === true) {
      if (!can(g.who.role, "samples.reference")) return NextResponse.json({ ok: false, error: "only an owner or a manager can put an original back" }, { status: 403 });
      const back = await restorePhotoOriginal(d, g.who.tenantId, id, b.base);
      await recordPress(d, g.who, "sample.photo_restore", "sample_photo", `${id}:${b.base}`);
      return NextResponse.json({ ok: true, ...back });
    }
    if (b.dish !== undefined) {
      const marked = await setPhotoDish(d, g.who.tenantId, id, b.base, b.dish);
      await recordPress(d, g.who, "sample.photo_dish", "sample_photo", `${id}:${b.base}`);
      return NextResponse.json({ ok: true, ...marked });
    }
    if (b.reject === true) return NextResponse.json({ ok: true, ...(await rejectPhoto(d, g.who.tenantId, id, b.base, b.note)) });
    return NextResponse.json({ ok: true, ...(await setPhotoChecks(d, g.who.tenantId, id, b.base, b.checks)) });
  } catch (err) {
    if (err instanceof SampleError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: publicReason(err, "samples.photo-checks") }, { status: 500 });
  }
}
