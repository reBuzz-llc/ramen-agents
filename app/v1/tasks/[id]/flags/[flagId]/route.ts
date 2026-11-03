import { NextResponse } from "next/server";
import { body, fail, failed, keyed } from "@/lib/board-api";
import { resolveTaskFlag as resolveFlag } from "@/lib/tasks";

// PATCH {actor, resolved: true}: resolve a flag (the Validator's key only). Answers {flag}.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; flagId: string }> }) {
  const k = await keyed(req, "board:validate");
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b || b.resolved !== true) return fail(400, "bad_request", "send {actor, resolved: true}");
  const { id, flagId } = await ctx.params;
  try {
    const flag = await resolveFlag(k.d, k.key.tenantId, id, flagId, typeof b.actor === "string" && b.actor ? b.actor : k.key.name);
    return flag ? NextResponse.json({ flag }) : fail(404, "not_found", `no flag ${flagId} on task ${id}`);
  } catch (err) {
    return failed(err, "v1.tasks.flags.resolve");
  }
}
