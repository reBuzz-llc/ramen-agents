// One lead: GET /v1/rows/{id} -> {lead} (404 when not on the board); PATCH {actor, fields, fill_only?} ->
// {lead, created, written, refused}, by the portal's rules (lib/local-board.ts).
import { answer, body, botActor, fail, keyed } from "@/lib/board-api";
import { getRow, writeRow } from "@/lib/local-board";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const k = keyed(req);
  if ("res" in k) return k.res;
  const id = (await ctx.params).id;
  const r = getRow(id);
  if (!r || r.board !== "leads") return fail(404, "not_found", `no lead ${id}`);
  return Response.json({ lead: r.row });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const k = keyed(req);
  if ("res" in k) return k.res;
  const id = (await ctx.params).id;
  const b = await body(req);
  if (!b || typeof b.fields !== "object" || !b.fields) return fail(400, "bad_request", "send {actor, fields}");
  if (getRow(id)?.board !== "leads") return fail(404, "not_found", `no lead ${id}`);
  return answer("lead", writeRow("leads", { id }, b.fields as Record<string, unknown>, botActor(k.name, b.actor), { fillOnly: b.fill_only === true }));
}
