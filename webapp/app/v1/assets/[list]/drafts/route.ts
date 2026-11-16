// Package drafts (queue 572): POST /v1/assets/packages/drafts {name, price, buyer, deliverables, offer?, why?, sources?,
// by?} -- an agent hands a package over; the same agent's draft of the same name is updated in place (201 new, 200
// update), a published package or a person's draft is never touched. GET -> {drafts: [...]} with each one's handover and
// review (reviewed_by, reviewed_at, review_verdict, review_note).
import { answer, body, botActor, fail, keyed } from "@/lib/board-api";
import { allRows, handOverPackage } from "@/lib/local-board";

type Ctx = { params: Promise<{ list: string }> };

export async function GET(req: Request, ctx: Ctx) {
  if ((await ctx.params).list !== "packages") return fail(404, "not_found", "drafts are on the packages list");
  const k = keyed(req);
  if ("res" in k) return k.res;
  return Response.json({ drafts: allRows("packages").filter((p) => p.status !== "published") });
}

export async function POST(req: Request, ctx: Ctx) {
  if ((await ctx.params).list !== "packages") return fail(404, "not_found", "drafts are on the packages list");
  const k = keyed(req);
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b) return fail(400, "bad_request", "send {name, price, buyer, deliverables, offer?, why?, sources?, by?}");
  return answer("package", handOverPackage(b, botActor(k.name, b.by)));
}
