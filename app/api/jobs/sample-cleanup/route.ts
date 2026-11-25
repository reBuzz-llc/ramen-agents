import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { runCleanup } from "@/lib/sample-cleanup";

// The samples' daily file clean-up (the rules in lib/sample-cleanup.ts). GET with "Authorization:
// Bearer <CRON_SECRET>" (the Mac's scripts/peek-sample-cleanup.sh sends it); it removes files, so it never runs without
// that secret set. A dry run is the default and lists what a sweep would remove; ?run=1 sweeps, and answers and logs
// counts and megabytes only.
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not set: the clean-up does not run" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const dry = new URL(req.url).searchParams.get("run") !== "1";
  try {
    const d = await db();
    const out: Record<string, unknown> = {};
    for (const t of await d.select({ id: tenants.id, slug: tenants.slug }).from(tenants)) out[t.slug] = await runCleanup(d, t.id, { dry });
    const counts = Object.fromEntries(Object.entries(out).map(([slug, r]) => { const { items: _items, ...rest } = r as { items?: unknown }; void _items; return [slug, rest]; }));
    console.log("jobs.sample-cleanup", JSON.stringify({ dry, counts }));
    return NextResponse.json({ ok: true, dry, tenants: out });
  } catch (err) {
    console.error("jobs.sample-cleanup", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "the clean-up failed; see the log" }, { status: 500 });
  }
}
