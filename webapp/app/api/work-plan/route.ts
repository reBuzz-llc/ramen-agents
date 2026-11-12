import { jsonResponse } from "@/lib/json-response";
import { BOTS_DIR, findBot, listBots } from "@/lib/bots";
import { sameOrigin } from "@/lib/same-origin";
import type { NextRequest } from "next/server";
import { attentionSince, pastJobs, refusalStats, workCards, writeOwnerPlan } from "@/lib/work-plan";
import { candidateFunnel } from "@/lib/candidates";
import { readMarkers } from "@/lib/changes";
import { readTick } from "@/lib/tick-read";
import { leadResults } from "@/lib/lead-results";
import { testRuns } from "@/lib/test-runs";
import { ceoMeasure } from "@/lib/ceo-measure";

const NO_STORE = { "cache-control": "no-store" };

// Every agent's checklist, the owner's goal and rules for it, and today's score; or, with ?since=<iso>, only what
// moved on the checklists since then (the header shortcut's red dot).
export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  if (since !== null) {
    const ok = /^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(since) ? since : "0000";
    return Response.json(await attentionSince(await listBots(), ok), { headers: NO_STORE });
  }
  try {
    const bots = await listBots();
    // One section of the page at a time (owner, 2026-10-31: the tabs are pages of their own, each loading only its
    // data). No part: everything, as before.
    const part = req.nextUrl.searchParams.get("part");
    if (part === "plan") return jsonResponse(req, await workCards(bots));
    if (part === "past") return jsonResponse(req, { past: await pastJobs(bots) });
    if (part === "leads") {
      const [candidates, results, tests] = await Promise.all([candidateFunnel(bots.find((b) => b.slug === "lead-gen")), leadResults(), testRuns()]);
      return jsonResponse(req, { candidates, results, tests });
    }
    if (part === "checks") {
      // B8 (queue 377): when this was read, and the Validator's tick line (red when stale)
      const [refusals, changes, ceo, tick] = await Promise.all([refusalStats(bots), readMarkers(14), ceoMeasure(), readTick(BOTS_DIR).catch(() => null)]);
      return jsonResponse(req, { refusals, changes, ceo, tick, at: new Date().toISOString() });
    }
    const [cards, past, refusals, candidates, changes, results, tests, ceo] = await Promise.all([
      workCards(bots),
      pastJobs(bots),
      refusalStats(bots),
      candidateFunnel(bots.find((b) => b.slug === "lead-gen")),
      readMarkers(14),
      leadResults(),
      testRuns(),
      ceoMeasure(),
    ]);
    return jsonResponse(req, { ...cards, past, refusals, candidates, changes, results, tests, ceo });
  } catch (err) {
    return Response.json({ error: `could not read the work plan: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}

// Save one agent's goal and rules: PUT {bot, goal, rules}. Only this app's own page may call it.
export async function PUT(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: { bot?: unknown; goal?: unknown; rules?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  const bot = typeof body.bot === "string" ? await findBot(body.bot) : null;
  if (!bot) return Response.json({ error: "not found" }, { status: 404 });
  try {
    const owner = await writeOwnerPlan(bot.slug, { goal: body.goal, rules: body.rules });
    return Response.json({ owner }, { headers: NO_STORE });
  } catch (err) {
    return Response.json({ error: `could not save: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
