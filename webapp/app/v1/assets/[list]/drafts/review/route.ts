// An agent's review of a package draft (queue 572): POST /v1/assets/packages/drafts/review {name, verdict:
// "approve"|"revise", note?, by?} -> {ok, id, reviewed_at}; 404 when no agent's draft has that name.
import { body, botActor, fail, keyed } from "@/lib/board-api";
import { reviewPackage } from "@/lib/local-board";

type Ctx = { params: Promise<{ list: string }> };

export async function POST(req: Request, ctx: Ctx) {
  if ((await ctx.params).list !== "packages") return fail(404, "not_found", "reviews are on the packages list");
  const k = keyed(req);
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b) return fail(400, "bad_request", "send {name, verdict, note?, by?}");
  const r = reviewPackage(b, botActor(k.name, b.by));
  return r.ok ? Response.json(r) : fail(r.code === "not_found" ? 404 : 400, r.code, r.message);
}
