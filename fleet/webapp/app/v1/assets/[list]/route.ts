// The asset lists, the hosted portal's paths: GET /v1/assets/packages(?status=published|draft) ->
// {packages: [...], updated_at}; GET /v1/assets/rates -> {rates: [...], updated_at}. People edit both on the dashboard's
// Packages page; an agent hands a package over as a draft (./drafts) and never publishes.
import { fail, keyed } from "@/lib/board-api";
import { allRows } from "@/lib/local-board";

type Ctx = { params: Promise<{ list: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const list = (await ctx.params).list;
  if (list !== "packages" && list !== "rates") return fail(404, "not_found", "the asset lists are: rates, packages");
  const k = keyed(req);
  if ("res" in k) return k.res;
  const status = new URL(req.url).searchParams.get("status");
  if (list === "packages" && status && status !== "published" && status !== "draft") return fail(400, "bad_request", "status is published or draft");
  const rows = allRows(list)
    .reverse()
    .filter((r) => list !== "packages" || !status || (r.status ?? "draft") === status)
    .map((r, i) => ({ ...r, position: i + 1, updated_by: r.last_edited_by }));
  const updated = rows.reduce((m, r) => (String((r as Record<string, unknown>).updated_at) > m ? String((r as Record<string, unknown>).updated_at) : m), "");
  return Response.json({ [list]: rows, updated_at: updated || null });
}
