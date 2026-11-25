import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runStaleTasks } from "@/lib/stale-tasks";

// The daily stale-task sweep, run once a day by the Mac's launchd job (09:00 UTC); Vercel has no cron for it, so it cannot run twice. The job sends
// "Authorization: Bearer <CRON_SECRET>" when that variable is set, and then nothing else may run it. Without it the run is
// open, which is harmless: it does only what the daily rule does, and archives nothing twice. Answers the counts.
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  try {
    const r = await runStaleTasks(await db());
    console.log("jobs.stale-tasks", JSON.stringify(r));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    console.error("jobs.stale-tasks", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "the sweep failed; see the function log" }, { status: 500 });
  }
}
