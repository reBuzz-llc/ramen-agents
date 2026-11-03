import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { changeTask, type PersonChange } from "@/lib/tasks";

// PATCH {status? | tick: {index, text, done} | assignees? | priority? | due?}: a person's change from the queue card
//, written as that person: it lands in the task's history and the bots never overwrite it.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as PersonChange | null;
  if (!b || typeof b !== "object") return NextResponse.json({ ok: false, error: "send the change" }, { status: 400 });
  const change: PersonChange = {};
  if (typeof b.status === "string") change.status = b.status;
  if (Array.isArray(b.assignees)) change.assignees = b.assignees.map(String);
  if (b.priority === null || typeof b.priority === "string") change.priority = b.priority;
  if (b.due === null || typeof b.due === "string") change.due = b.due;
  if (b.tick && Number.isInteger(b.tick.index) && typeof b.tick.text === "string" && typeof b.tick.done === "boolean") change.tick = b.tick;
  try {
    const r = await changeTask(await db(), g.who.tenantId, (await ctx.params).id, { kind: "person", name: g.who.name || g.who.email, userId: g.who.userId }, change);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.message }, { status: r.code === "not_found" ? 404 : 400 });
    return NextResponse.json({ ok: true, task: r.task });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "tasks.change") }, { status: 500 });
  }
}
