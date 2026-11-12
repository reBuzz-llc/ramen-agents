import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { BOTS_DIR, CODE_ROOT, findBot } from "@/lib/bots";
import { workspaceDir } from "@/lib/control";
import { currentIdentity } from "@/lib/identity";
import { control } from "@/lib/owner-controls";
import { decideRoster, type Edits } from "@/lib/roster-proposals";
import { sameOrigin } from "@/lib/same-origin";

// The owner's Approve / Decline on a roster proposal (creatorCC queue 440): POST {id, approve, note?, edits?}. Same-origin
// only. An approved start or stop runs the owner's own start/stop path (as the world's Start and Stop do); rename,
// create and retire run scripts/roster_apply.py <id> with the engine's Python.
export const maxDuration = 200;

function rosterApply(id: string): Promise<{ ok: boolean; text: string }> {
  const venv = path.join(CODE_ROOT, ".venv", "bin", "python");
  const py = existsSync(venv) ? venv : "python3";
  const script = path.join(process.env.FLEET_SCRIPTS_DIR ?? path.join(BOTS_DIR, "scripts"), "roster_apply.py");
  return new Promise((resolve) => {
    execFile(py, [script, id], { timeout: 120_000, env: { ...process.env, BOTS_DIR } }, (err, stdout, stderr) => {
      const out = `${stdout}`.trim() || `${stderr}`.trim().split("\n").pop() || "";
      resolve({ ok: !err && /: applied:/.test(out), text: out || (err ? err.message : "no output") });
    });
  });
}

export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: { id?: unknown; approve?: unknown; note?: unknown; edits?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  if (typeof body.id !== "string" || typeof body.approve !== "boolean") return Response.json({ error: "expected {id, approve}" }, { status: 400 });
  const raw = body.edits && typeof body.edits === "object" ? (body.edits as Record<string, unknown>) : {};
  const edits: Edits = {
    ...(typeof raw.name === "string" ? { name: raw.name } : {}),
    ...(typeof raw.goal === "string" ? { goal: raw.goal } : {}),
    ...(raw.persona && typeof raw.persona === "object"
      ? { persona: Object.fromEntries(Object.entries(raw.persona as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string> }
      : {}),
  };
  const who = (await currentIdentity()).name;
  try {
    const res = await decideRoster(body.id, body.approve, typeof body.note === "string" ? body.note : "", edits, {
      startStop: async (slug, action, via, note) => {
        const bot = await findBot(slug);
        if (!bot) return { ok: false, text: `${slug} is not a member on this Mac` };
        const ctx = {
          slug,
          ws: await workspaceDir(bot),
          scripts: process.env.FLEET_SCRIPTS_DIR ?? path.join(BOTS_DIR, "scripts"),
          log: path.join(BOTS_DIR, "common-data", "shared-state", "owner-controls.jsonl"),
          who,
        };
        return control(ctx, action, { reason: note || `approved the CEO's proposal ${body.id}`, via });
      },
      roster: rosterApply,
    });
    return Response.json(res, { status: res.ok ? 200 : 409 });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
