import { fail, keyed, metered } from "@/lib/board-api";
import { getLead, historyOf } from "@/lib/leads";

// GET: a lead's history, newest first: every change and every refused attempt, with its actor.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  const { id } = await ctx.params;
  if (!(await getLead(k.d, k.key.tenantId, { id }))) return fail(404, "not_found", `no lead ${id}`);
  return metered(k.d, k.key, { history: await historyOf(k.d, k.key.tenantId, id) });
}
