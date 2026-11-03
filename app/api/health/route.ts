import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// GET: the database answers (select 1), and how long it took. No sign-in, no data. A ping here also wakes the database
// after Neon's free tier has suspended it (about five idle minutes); see the README before scheduling pings.
export async function GET() {
  const t = Date.now();
  try {
    await (await db()).execute(sql`select 1`);
    return NextResponse.json({ ok: true, ms: Date.now() - t }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
