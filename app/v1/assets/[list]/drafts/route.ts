import { NextResponse } from "next/server";
import { addDraft, checkDraft } from "@/lib/assets";
import { body, fail, failed, keyed } from "@/lib/board-api";

// POST /v1/assets/packages/drafts: a bot hands a package over as a draft on the Asset page, with any
// board:write key ({name, price, buyer, deliverables, offer?, why?, sources?, by?}; `by` is the agent, else the key's
// name). The same agent's draft of the same name is updated in place; a published package or a person's draft is never
// touched, and a bot never publishes: the owner prices and publishes on the page. 201 for a new draft, 200 for an update.
export async function POST(req: Request, ctx: { params: Promise<{ list: string }> }) {
  if ((await ctx.params).list !== "packages") return fail(404, "not_found", "drafts are for packages: POST /v1/assets/packages/drafts");
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  const c = checkDraft(b);
  if (!c.ok) return fail(400, "bad_request", c.message);
  const by = typeof b?.by === "string" && b.by.trim() ? b.by.trim().slice(0, 80) : k.key.name;
  try {
    const r = await addDraft(k.d, k.key.tenantId, c.draft, by);
    return NextResponse.json({ ok: true, id: r.id, created: r.created, status: "draft" }, { status: r.created ? 201 : 200 });
  } catch (err) {
    return failed(err, "v1.assets.drafts");
  }
}
