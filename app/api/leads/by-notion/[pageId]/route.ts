import { NextResponse } from "next/server";
import { body, botActor, fail, failed, keyed } from "@/lib/board-api";
import { getLead, writeLead } from "@/lib/leads";

// The backfill's contract: a lead by its Notion page id.
type Ctx = { params: Promise<{ pageId: string }> };
const pageIdOf = async (ctx: Ctx) => {
  const id = (await ctx.params).pageId.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(id) ? id : null;
};

// GET: {lead} or 404.
export async function GET(req: Request, ctx: Ctx) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  const pageId = await pageIdOf(ctx);
  const lead = pageId ? await getLead(k.d, k.key.tenantId, { notionPageId: pageId }) : null;
  return lead ? NextResponse.json({ lead }) : fail(404, "not_found", "no lead with that Notion page id");
}

// PUT {actor, lead}: an upsert that copies Notion's values as they are (the import key only), recorded in each cell's
// history under the actor. A second PUT of the same lead changes nothing.
export async function PUT(req: Request, ctx: Ctx) {
  const k = await keyed(req, "board:import");
  if ("res" in k) return k.res;
  const pageId = await pageIdOf(ctx);
  if (!pageId) return fail(400, "bad_request", "the path carries a Notion page id (32 hex characters)");
  const b = await body(req);
  if (!b || typeof b.lead !== "object" || !b.lead) return fail(400, "bad_request", "send {actor, lead}");
  const lead = { ...(b.lead as Record<string, unknown>) };
  if (lead.notion_page_id && String(lead.notion_page_id).replace(/-/g, "").toLowerCase() !== pageId) return fail(400, "bad_request", "lead.notion_page_id differs from the path");
  delete lead.notion_page_id;
  try {
    const r = await writeLead(k.d, k.key.tenantId, { notionPageId: pageId }, lead, botActor(k.key, b.actor), { create: true, import: true });
    if (!r.ok) return fail(r.code === "not_found" ? 404 : 400, r.code, r.message);
    return NextResponse.json({ lead: r.lead, created: r.created, written: r.written }, { status: r.created ? 201 : 200 });
  } catch (err) {
    return failed(err, "leads.by-notion");
  }
}
