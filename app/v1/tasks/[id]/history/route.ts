import { NextResponse } from "next/server";
import { fail, keyed } from "@/lib/board-api";
import { getTask, taskHistory } from "@/lib/tasks";

// GET: a task's history, newest first: every change and every refused attempt, with its actor.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  const { id } = await ctx.params;
  if (!(await getTask(k.d, k.key.tenantId, { id }))) return fail(404, "not_found", `no task ${id}`);
  return NextResponse.json({ history: await taskHistory(k.d, k.key.tenantId, id) });
}
