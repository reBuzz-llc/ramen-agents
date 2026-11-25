import { NextResponse } from "next/server";
import { sessionHint } from "@/lib/auth";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { can } from "@/lib/roles";
import { listSamples, sampleVersionsOf } from "@/lib/samples";
import { readsWith } from "@/lib/session-hint";

// GET ?lead_id=: the lead's sample drafts for its Sample box, and whether this person may approve
// or take one down (samples.review).
export async function GET(req: Request) {
  const leadId = new URL(req.url).searchParams.get("lead_id") ?? "";
  let refused: NextResponse | undefined;
  try {
    const d = await db();
    // read alongside the sign-in check; nothing is answered unless the check passes
    const got = await readsWith(
      await sessionHint(),
      async () => {
        const g = await guard("queue.work");
        if ("res" in g) refused = g.res;
        return "res" in g ? null : g.who;
      },
      async ({ tenantId }) => {
        if (!leadId) return null;
        const samples = await listSamples(d, tenantId, { leadId });
        // the newest sample's versions for the Sample box's version list
        return { samples, versions: samples[0] ? await sampleVersionsOf(d, tenantId, samples[0].id) : [] };
      },
    );
    if (!got) return refused ?? NextResponse.json({ ok: false, error: "sign in first" }, { status: 401 });
    if (!got.data) return NextResponse.json({ ok: false, error: "lead_id is required" }, { status: 400 });
    return NextResponse.json({ ok: true, samples: got.data.samples, versions: got.data.versions, canReview: can(got.who.role, "samples.review") });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "samples.list") }, { status: 500 });
  }
}
