import { NextResponse } from "next/server";
import { answerTask, body, botActor, fail, failed, keyed } from "@/lib/board-api";
import { getTask, writeTask } from "@/lib/tasks";

type Ctx = { params: Promise<{ id: string }> };

// GET: one task, as stored.
export async function GET(req: Request, ctx: Ctx) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  const { id } = await ctx.params;
  const task = await getTask(k.d, k.key.tenantId, { id });
  return task ? NextResponse.json({ task }) : fail(404, "not_found", `no task ${id}`);
}

// PATCH {actor, fields, details_append?}: the given fields, and a paragraph added to the details; answers the task as
// stored with what was written and what was refused (person_wins, human_only) and why.
export async function PATCH(req: Request, ctx: Ctx) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  const fields = b && typeof b.fields === "object" && b.fields ? (b.fields as Record<string, unknown>) : {};
  if (!b || (!Object.keys(fields).length && typeof b.details_append !== "string")) return fail(400, "bad_request", "send {actor, fields, details_append?}");
  try {
    return answerTask(await writeTask(k.d, k.key.tenantId, { id: (await ctx.params).id }, fields, botActor(k.key, b.actor), { detailsAppend: typeof b.details_append === "string" ? b.details_append : undefined }));
  } catch (err) {
    return failed(err, "v1.tasks.update");
  }
}

export function DELETE() {
  return fail(405, "method_not_allowed", "tasks are archived by people in the app, never deleted with a key");
}
