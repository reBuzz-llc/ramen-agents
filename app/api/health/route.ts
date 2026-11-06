import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dbState } from "@/lib/db-state";

// GET: the database answers (select 1), and how long it took. No sign-in, no data. A ping here also wakes the database
// after Neon's free tier has suspended it (about five idle minutes); see the README before scheduling pings.
// The Validator reads the answer: {ok, db: "ok" | "quota" | "down", since?}. "quota" is Neon
// refusing every connection because the project's free allowance is used up (its message "exceeded the quota", the
// code 53000 class); `since` is when this server first saw that state (kept in memory: a new instance starts again).
let firstBad: { db: "quota" | "down"; at: string } | null = null;

export async function GET() {
  const t = Date.now();
  try {
    await (await db()).execute(sql`select 1`);
    firstBad = null;
    return NextResponse.json({ ok: true, db: "ok", ms: Date.now() - t }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const state = dbState(err);
    if (!firstBad || firstBad.db !== state) firstBad = { db: state, at: new Date().toISOString() };
    return NextResponse.json({ ok: false, db: state, since: firstBad.at }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
