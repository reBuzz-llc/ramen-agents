import { answer, answerTask, body, botActor, fail, failed, keyed, metered, notModified, queryOf } from "@/lib/board-api";
import { boardRev, fieldsOf, listLeads, writeLead } from "@/lib/leads";
import { sha256 } from "@/lib/crypto";
import { listTasks, writeTask } from "@/lib/tasks";

type Ctx = { params: Promise<{ board: string }> };
const boardOf = async (ctx: Ctx) => {
  const b = (await ctx.params).board;
  return b === "leads" || b === "tasks" ? b : null;
};
const noBoard = () => fail(404, "not_found", "the boards here are: leads, tasks");

// GET: leads changed after ?since=<rev> (0 or none for all), in rev order, with the filters in lib/board-api queryOf.
// Answers {leads, next, more}: ask again with since=next. The tasks board: tasks changed after ?since=<rev>, with
// ?status= and ?archived=true, as {tasks, next, more}. Egress: ?fields= (a list of cells, "slim"
// or "all"; see lib/leads fieldsOf) picks the lead cells; every answer has an ETag on the board's newest rev and the
// query, so a reader sending it back as If-None-Match gets 304 and no body when nothing changed; x-peek-bytes says the
// size, and each key's day is counted in api_key_days.
export async function GET(req: Request, ctx: Ctx) {
  const board = await boardOf(ctx);
  if (!board) return noBoard();
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  const url = new URL(req.url);
  const etag = `W/"${board}-${await boardRev(k.d, k.key.tenantId, board)}-${sha256(url.search).slice(0, 12)}"`;
  if (req.headers.get("if-none-match") === etag) return notModified(k.d, k.key, etag);
  if (board === "tasks") {
    const p = url.searchParams;
    const since = p.get("since") ? Number(p.get("since")) : undefined;
    const limit = p.get("limit") ? Number(p.get("limit")) : undefined;
    if ([since, limit].some((n) => n !== undefined && !Number.isFinite(n))) return fail(400, "bad_query", "since and limit are numbers");
    return metered(k.d, k.key, await listTasks(k.d, k.key.tenantId, { since, limit, status: p.get("status") ?? undefined, archived: p.get("archived") === "true" }), { etag });
  }
  const q = queryOf(url);
  if ([q.since, q.limit, q.minScore].some((n) => n !== undefined && !Number.isFinite(n))) return fail(400, "bad_query", "since, limit and min_score are numbers");
  const f = fieldsOf(url.searchParams.get("fields"));
  if (!f.ok) return fail(400, "bad_query", f.message);
  return metered(k.d, k.key, await listLeads(k.d, k.key.tenantId, q, f.keys), { etag });
}

// POST {actor, fields, source_url?}: a new lead. The same website domain (or, with none, name and city) is refused as
// duplicate_row with the existing id. The tasks board: POST {actor, fields, details_append?} makes a task (a bot's starts
// "Not started", unassigned, its checklist unticked).
export async function POST(req: Request, ctx: Ctx) {
  const board = await boardOf(ctx);
  if (!board) return noBoard();
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b || typeof b.fields !== "object" || !b.fields) return fail(400, "bad_request", "send {actor, fields}");
  try {
    if (board === "tasks")
      return answerTask(
        await writeTask(k.d, k.key.tenantId, {}, b.fields as Record<string, unknown>, botActor(k.key, b.actor), { create: true, detailsAppend: typeof b.details_append === "string" ? b.details_append : undefined }),
      );
    return answer(
      await writeLead(k.d, k.key.tenantId, { notionPageId: typeof b.notion_page_id === "string" ? b.notion_page_id : undefined }, b.fields as Record<string, unknown>, botActor(k.key, b.actor), {
        create: true,
        sourceUrl: typeof b.source_url === "string" ? b.source_url : null,
      }),
    );
  } catch (err) {
    return failed(err, "v1.create");
  }
}
