import type { NextRequest } from "next/server";
import { findBot } from "@/lib/bots";
import { readDigest, writeDigest } from "@/lib/digest";
import { sameOrigin } from "@/lib/same-origin";
import { RANGES, type RangeKey } from "@/lib/summary";

const NO_STORE = { "cache-control": "no-store" };

async function target(slug: string, raw: unknown) {
  const bot = await findBot(slug);
  const range = String(raw ?? "24h") as RangeKey;
  if (!bot) return { error: Response.json({ error: "not found" }, { status: 404 }) };
  if (!(range in RANGES)) return { error: Response.json({ error: "range must be 24h, 7d, 30d or 90d" }, { status: 400 }) };
  return { bot, range };
}

// The saved recap for ?range=, or null when none has been written yet.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/bots/[slug]/digest">) {
  const t = await target((await ctx.params).slug, req.nextUrl.searchParams.get("range"));
  if (t.error) return t.error;
  return Response.json({ digest: await readDigest(t.bot, t.range) }, { headers: NO_STORE });
}

// Write a new recap with the bot's own model: POST {range}. Can take a minute on a local model.
export async function POST(req: Request, ctx: RouteContext<"/api/bots/[slug]/digest">) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: { range?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  const t = await target((await ctx.params).slug, body.range);
  if (t.error) return t.error;
  try {
    return Response.json({ digest: await writeDigest(t.bot, t.range) }, { headers: NO_STORE });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "could not write the recap" }, { status: 502 });
  }
}
