import { findBot } from "@/lib/bots";
import { restartBot, runBot, stopBot } from "@/lib/control";
import { sameOrigin } from "@/lib/same-origin";

// Run, stop or restart one bot. Only this app's own page may call it (lib/same-origin.ts).

// One action per bot at a time, so a double click cannot start two agents.
const busy = new Set<string>();

export async function POST(req: Request, ctx: RouteContext<"/api/bots/[slug]/control">) {
  if (!(await sameOrigin(req))) return Response.json({ ok: false, note: "forbidden" }, { status: 403 });
  const { slug } = await ctx.params;
  const bot = await findBot(slug);
  if (!bot) return Response.json({ ok: false, note: "not found" }, { status: 404 });

  let op: unknown;
  try {
    op = ((await req.json()) as { op?: unknown }).op;
  } catch {
    return Response.json({ ok: false, note: "expected JSON" }, { status: 400 });
  }
  if (op !== "run" && op !== "stop" && op !== "restart") {
    return Response.json({ ok: false, note: "op must be run, stop or restart" }, { status: 400 });
  }

  if (busy.has(slug)) return Response.json({ ok: false, note: `${bot.name} is already starting or stopping.` }, { status: 409 });
  busy.add(slug);
  try {
    const result = op === "run" ? await runBot(bot) : op === "stop" ? await stopBot(bot) : await restartBot(bot);
    return Response.json(result, { status: result.ok ? 200 : 500, headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ ok: false, note: err instanceof Error ? err.message : String(err) }, { status: 500 });
  } finally {
    busy.delete(slug);
  }
}
