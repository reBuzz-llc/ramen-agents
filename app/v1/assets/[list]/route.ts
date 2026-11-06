import { NextResponse } from "next/server";
import { checkPackages, checkRates, keyMayNotPublish, latest, listPackages, listRates, listSections, packageJson, rateJson, savePackages, saveRates, sectionJson } from "@/lib/assets";
import { body, fail, failed, keyed } from "@/lib/board-api";

// The Asset page's lists for your agents. GET with any board:read key (the Validator's
// price guard, the Writer's offer reader): {rates: [{id, position, line, offer, price, updated_at, updated_by}]} or
// {packages: [{id, position, name, price, offer, buyer, deliverables, status, updated_at, updated_by}]}, in the page's
// order, with the list's updated_at; ?status=published for the published packages only. PUT with the owner's
// assets:write key: the whole list, in order ({rates: [...]} or {packages: [...]}); rows with an id are kept, the
// rest added, the ones left out deleted. {sections: [{id, position, title, kind, body, ...}]} is the Asset page's "What
// we have" text, also at /v1/assets/company; read with a key, edited only by
// people on the page (a key's PUT is 405). A key never publishes: a PUT that would publish a
// package, change a published one's name or price, or remove a published one is refused with 405.
const LISTS = ["rates", "packages", "sections"] as const;
type List = (typeof LISTS)[number];
const listOf = async (ctx: { params: Promise<{ list: string }> }) => {
  const l = (await ctx.params).list;
  return (LISTS as readonly string[]).includes(l) ? (l as List) : null;
};

export async function GET(req: Request, ctx: { params: Promise<{ list: string }> }) {
  const list = await listOf(ctx);
  if (!list) return fail(404, "not_found", "the asset lists are: rates, packages, sections");
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  if (list === "rates") {
    const rows = await listRates(k.d, k.key.tenantId);
    return NextResponse.json({ rates: rows.map(rateJson), updated_at: latest(rows) });
  }
  if (list === "sections") {
    const rows = await listSections(k.d, k.key.tenantId);
    return NextResponse.json({ sections: rows.map(sectionJson), updated_at: latest(rows) });
  }
  const status = new URL(req.url).searchParams.get("status");
  if (status && status !== "published" && status !== "draft") return fail(400, "bad_request", "status is published or draft");
  const rows = await listPackages(k.d, k.key.tenantId, (status as "published" | "draft" | null) ?? undefined);
  return NextResponse.json({ packages: rows.map(packageJson), updated_at: latest(rows) });
}

export async function PUT(req: Request, ctx: { params: Promise<{ list: string }> }) {
  const list = await listOf(ctx);
  if (!list) return fail(404, "not_found", "the asset lists are: rates, packages, sections");
  if (list === "sections") return fail(405, "person_only", "the company sections are edited by people on the Asset page; a key reads them");
  const k = await keyed(req, "assets:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b) return fail(400, "bad_request", `send {${list}: [...]}`);
  const by = typeof b.by === "string" && b.by.trim() ? b.by.trim().slice(0, 80) : k.key.name;
  try {
    const c = list === "rates" ? checkRates(b.rates) : checkPackages(b.packages);
    if (!c.ok) return fail(400, "bad_request", c.message);
    if (list === "packages") {
      const no = keyMayNotPublish(await listPackages(k.d, k.key.tenantId), c.items as never);
      if (no) return fail(405, "person_only", no);
    }
    const r = list === "rates" ? await saveRates(k.d, k.key.tenantId, c.items as never, by) : await savePackages(k.d, k.key.tenantId, c.items as never, by);
    if (!r.ok) return fail(409, "stale_list", r.message);
    return NextResponse.json({ ok: true, added: r.added, changed: r.changed, removed: r.removed, count: c.items.length });
  } catch (err) {
    return failed(err, "v1.assets");
  }
}
