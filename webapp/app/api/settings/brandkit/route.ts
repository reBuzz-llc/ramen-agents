import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { sameOrigin } from "@/lib/same-origin";

const run = promisify(execFile);

// Run the brand kit freshness check now (Settings > About). It rewrites applebrandkit.md's status section.
export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    const { stdout } = await run(process.execPath, [path.join(process.cwd(), "scripts", "brandkit-check.mjs"), "--quiet"], { cwd: process.cwd(), timeout: 120000 });
    return Response.json({ ok: true, summary: stdout.trim().split("\n").pop() ?? "" }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ ok: false, summary: err instanceof Error ? err.message.split("\n")[0] : "check failed" }, { status: 500 });
  }
}
