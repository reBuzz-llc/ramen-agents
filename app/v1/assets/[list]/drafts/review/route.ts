import { NextResponse } from "next/server";
import { checkReview, reviewDraft } from "@/lib/assets";
import { body, fail, failed, keyed } from "@/lib/board-api";

// POST /v1/assets/packages/drafts/review (board:write): an agent's review of a package draft
// another agent handed over, {name, verdict: "approve"|"revise", note? (≤ 500 characters, masked), by?}. It stamps
// reviewed_by, reviewed_at, review_verdict and review_note on the newest such draft of that name; a published package or
// a person's draft is never touched (404 when there is no agent's draft of that name). The owner still prices and
// publishes on the page. Answers {ok, id, reviewed_at}.
export async function POST(req: Request, ctx: { params: Promise<{ list: string }> }) {
  if ((await ctx.params).list !== "packages") return fail(404, "not_found", "reviews are for package drafts: POST /v1/assets/packages/drafts/review");
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const c = checkReview(await body(req), k.key.name);
  if (!c.ok) return fail(400, "bad_request", c.message);
  try {
    const r = await reviewDraft(k.d, k.key.tenantId, c.review);
    return r ? NextResponse.json({ ok: true, id: r.id, reviewed_at: r.reviewedAt }) : fail(404, "not_found", `no agent's draft named ${c.review.name}`);
  } catch (err) {
    return failed(err, "v1.assets.drafts.review");
  }
}
