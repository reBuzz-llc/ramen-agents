import { NextResponse } from "next/server";
import { body, fail, failed, keyed } from "@/lib/board-api";
import { flagsOf, raiseFlag } from "@/lib/flags";

type Ctx = { params: Promise<{ id: string }> };

// GET: {flags: [...]}, open and resolved, oldest first.
export async function GET(req: Request, ctx: Ctx) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  const { id } = await ctx.params;
  const flags = await flagsOf(k.d, k.key.tenantId, id);
  return flags ? NextResponse.json({ flags }) : fail(404, "not_found", `no lead ${id}`);
}

// POST {actor, rule, detail}: raise a flag (the Validator's key only). One per rule: an open one keeps its id and takes
// the new detail; a resolved one reopens. Answers {flag}.
export async function POST(req: Request, ctx: Ctx) {
  const k = await keyed(req, "board:validate");
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b || typeof b.rule !== "string" || !b.rule.trim()) return fail(400, "bad_request", "send {actor, rule, detail}");
  const { id } = await ctx.params;
  try {
    const flag = await raiseFlag(k.d, k.key.tenantId, id, b.rule, typeof b.detail === "string" ? b.detail : "", typeof b.actor === "string" && b.actor ? b.actor : k.key.name);
    return flag ? NextResponse.json({ flag }) : fail(404, "not_found", `no lead ${id}`);
  } catch (err) {
    return failed(err, "v1.flags");
  }
}
