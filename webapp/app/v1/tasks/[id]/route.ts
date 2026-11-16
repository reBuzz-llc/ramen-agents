// One task (queue 572): GET /v1/tasks/{id} -> {task}; PATCH {actor, fields, details_append?} -> {task, created, written,
// refused}. A task's status, assignees and checklist are the team's: an agent's write to them is refused (human_only), so
// a merge only appends "Merged into ..." to the details (details_append) and a person moves the status.
import { answer, body, botActor, fail, keyed } from "@/lib/board-api";
import { getRow, writeRow } from "@/lib/local-board";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const k = keyed(req);
  if ("res" in k) return k.res;
  const id = (await ctx.params).id;
  const r = getRow(id);
  if (!r || r.board !== "tasks") return fail(404, "not_found", `no task ${id}`);
  return Response.json({ task: r.row });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const k = keyed(req);
  if ("res" in k) return k.res;
  const id = (await ctx.params).id;
  const r = getRow(id);
  if (!r || r.board !== "tasks") return fail(404, "not_found", `no task ${id}`);
  const b = await body(req);
  if (!b || (typeof b.fields !== "object" && typeof b.details_append !== "string")) return fail(400, "bad_request", "send {actor, fields, details_append?}");
  const fields = { ...((b.fields as Record<string, unknown>) ?? {}) };
  if (typeof b.details_append === "string" && b.details_append.trim())
    fields.details = [r.row.details, b.details_append].filter((x) => typeof x === "string" && x.trim()).join("\n\n");
  return answer("task", writeRow("tasks", { id }, fields, botActor(k.name, b.actor)));
}
