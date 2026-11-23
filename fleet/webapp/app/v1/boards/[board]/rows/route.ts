// The local board's rows, the hosted portal's paths and answers:
//   GET  /v1/boards/leads/rows?since=<rev>&limit=<1..500>&fields=all  -> {leads, next, more}, ETag (304 when unchanged)
//   GET  /v1/boards/tasks/rows?since&limit&status&archived            -> {tasks, next, more}
//   POST /v1/boards/leads/rows {actor, fields}                        -> 201 {lead, created, written, refused}; 409 duplicate_row
//   POST /v1/boards/tasks/rows {actor, fields, details_append?}       -> 201 {task, ...}; a bot's task starts "Not started"
import { answer, body, botActor, fail, keyed, num, queryHash, withEtag } from "@/lib/board-api";
import { boardRev, listRows, writeRow } from "@/lib/local-board";

type Ctx = { params: Promise<{ board: string }> };
const boardOf = async (ctx: Ctx) => {
  const b = (await ctx.params).board;
  return b === "leads" || b === "tasks" ? b : null;
};

export async function GET(req: Request, ctx: Ctx) {
  const board = await boardOf(ctx);
  if (!board) return fail(404, "not_found", "the boards here are: leads, tasks");
  const k = keyed(req);
  if ("res" in k) return k.res;
  const p = new URL(req.url).searchParams;
  const since = num(p.get("since"));
  const limit = num(p.get("limit"));
  if ([since, limit].some((n) => n !== undefined && !Number.isFinite(n))) return fail(400, "bad_query", "since and limit are numbers");
  const etag = `W/"${board}-${boardRev(board)}-${queryHash(new URL(req.url).search)}"`;
  const r = listRows(board, { since, limit, archived: p.get("archived") === "true", status: board === "tasks" ? p.get("status") ?? undefined : undefined });
  return withEtag(req, etag, { [board]: r.rows, next: r.next, more: r.more });
}

export async function POST(req: Request, ctx: Ctx) {
  const board = await boardOf(ctx);
  if (!board) return fail(404, "not_found", "the boards here are: leads, tasks");
  const k = keyed(req);
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b || typeof b.fields !== "object" || !b.fields) return fail(400, "bad_request", "send {actor, fields}");
  const fields = { ...(b.fields as Record<string, unknown>) };
  if (board === "tasks" && typeof b.details_append === "string" && b.details_append.trim())
    fields.details = [fields.details, b.details_append].filter((x) => typeof x === "string" && x.trim()).join("\n\n");
  return answer(board === "leads" ? "lead" : "task", writeRow(board, {}, fields, botActor(k.name, b.actor), { create: true }));
}
