import path from "node:path";
import { BOTS_DIR, findBot } from "@/lib/bots";
import { workspaceDir } from "@/lib/control";
import { currentIdentity } from "@/lib/identity";
import { control, type Action, type PauseFor } from "@/lib/owner-controls";
import { sameOrigin } from "@/lib/same-origin";

// The owner's Pause / Resume / Stop / Start from the world's text box: POST {bot, action, for?,
// reason?}. Same-origin only; runs the fleet scripts as the dashboard's user and answers with what they printed.
// Engine restarts for updates stay with whoever maintains the engine; this is the owner's hand on one bot.
export const maxDuration = 200;
const ACTIONS: Action[] = ["pause", "resume", "stop", "start", "bringback"];
const PAUSES: PauseFor[] = ["30m", "2h", "tomorrow"];

export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: { bot?: unknown; action?: unknown; for?: unknown; reason?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  const action = ACTIONS.find((a) => a === body.action);
  const bot = typeof body.bot === "string" ? await findBot(body.bot) : null;
  if (!bot || !action) return Response.json({ error: "expected {bot, action: pause | resume | stop | start}" }, { status: 400 });
  const choice = PAUSES.find((p) => p === body.for);
  try {
    const res = await control(
      {
        slug: bot.slug,
        ws: await workspaceDir(bot),
        scripts: process.env.FLEET_SCRIPTS_DIR ?? path.join(BOTS_DIR, "scripts"),
        log: path.join(BOTS_DIR, "common-data", "shared-state", "owner-controls.jsonl"),
        who: (await currentIdentity()).name,
      },
      action,
      { choice, reason: typeof body.reason === "string" ? body.reason : "" },
    );
    return Response.json(res, { status: res.ok ? 200 : 409 });
  } catch (err) {
    return Response.json({ ok: false, text: `could not ${action}: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
