import { answer, body, botActor, fail, failed, keyed, metered } from "@/lib/board-api";
import { getLead, writeLead } from "@/lib/leads";

type Ctx = { params: Promise<{ id: string }> };

// GET: one lead, as stored.
export async function GET(req: Request, ctx: Ctx) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  const { id } = await ctx.params;
  const lead = await getLead(k.d, k.key.tenantId, { id });
  return lead ? metered(k.d, k.key, { lead }) : fail(404, "not_found", `no lead ${id}`);
}

// PATCH {actor, fields, fill_only?, source_url?}: the given fields; answers the row as stored with what was written
// and what was refused (person_wins, human_only, filled) and why.
export async function PATCH(req: Request, ctx: Ctx) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b || typeof b.fields !== "object" || !b.fields) return fail(400, "bad_request", "send {actor, fields}");
  try {
    return answer(
      await writeLead(k.d, k.key.tenantId, { id: (await ctx.params).id }, b.fields as Record<string, unknown>, botActor(k.key, b.actor), {
        fillOnly: b.fill_only === true,
        sourceUrl: typeof b.source_url === "string" ? b.source_url : null,
      }),
    );
  } catch (err) {
    return failed(err, "v1.update");
  }
}

export function DELETE() {
  return fail(405, "method_not_allowed", "leads are archived by people in the app, never deleted with a key");
}
