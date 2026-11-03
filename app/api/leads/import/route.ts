import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { BATCH, IMPORT_FIELDS, MAX_ROWS, planImport, runImport, type Batch, type ImportField, type MappedRow, type PlanLine, type Rules } from "@/lib/lead-import";
import { sameOrigin } from "@/lib/same-origin";

// A batch of 500 new leads, each with its history, can take a while: up to a minute (Vercel Hobby's limit).
export const maxDuration = 60;

const clean = (r: unknown): MappedRow => {
  const out: MappedRow = {};
  if (r && typeof r === "object")
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) if (IMPORT_FIELDS.includes(k as ImportField) && typeof v === "string" && v.trim()) out[k as ImportField] = v.trim().slice(0, 2000);
  return out;
};
const rulesOf = (v: unknown): Rules => {
  const r = (v ?? {}) as Partial<Rules>;
  return {
    states: Array.isArray(r.states) ? r.states.map((s) => String(s).toUpperCase().slice(0, 2)).filter(Boolean) : null,
    skipClosed: r.skipClosed === true,
    skipChains: r.skipChains === true,
    needContact: r.needContact === true,
  };
};

// POST {dry: true, records (each row's keys: lib/lead-import-map keyOf), rules}: the dry run on the whole file. Answers
// the two batches' row numbers (with an email; phone or WhatsApp only), the rows with neither, what the rules left out
// and why, the duplicates, the rejected, and every row not created (for the report).
// POST {dry: false, records: [{row, ...fields}], batch, maps, packageForWebsite, fileName, importId?, excluded?}: up to
// 500 approved rows imported; the first batch answers the import's id, later ones pass it so the report stays one.
// Owners and managers.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("leads.import");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || !Array.isArray(b.records)) return NextResponse.json({ ok: false, error: "send {records}" }, { status: 400 });
  const dry = b.dry !== false;
  if (b.records.length > (dry ? MAX_ROWS : BATCH)) return NextResponse.json({ ok: false, error: dry ? `At most ${MAX_ROWS} rows; split the file.` : `At most ${BATCH} rows a batch.` }, { status: 413 });
  const d = await db();
  try {
    if (dry) {
      const plan = await planImport(d, g.who.tenantId, b.records.map(clean), rulesOf(b.rules));
      const of = (batch: Batch) => plan.filter((l) => l.outcome === "create" && l.batch === batch);
      const reasons = (o: PlanLine["outcome"]) => {
        const m = new Map<string, number>();
        for (const l of plan.filter((x) => x.outcome === o)) {
          const k = l.reason.replace(/:.*$/, "").replace(/row \d+ of this file/, "an earlier row in this file");
          m.set(k, (m.get(k) ?? 0) + 1);
        }
        return [...m].map(([reason, n]) => ({ reason, n })).sort((x, y) => y.n - x.n);
      };
      const email = of("email");
      const listing = of("listing");
      return NextResponse.json({
        ok: true,
        email: { rows: email.map((l) => l.row), social: email.filter((l) => l.social).length },
        listing: { rows: listing.map((l) => l.row), social: listing.filter((l) => l.social).length },
        excluded: reasons("excluded"),
        skipped: reasons("skipped"),
        rejected: plan.filter((l) => l.outcome === "rejected").length,
        notCreated: plan.filter((l) => l.outcome !== "create").map((l) => ({ row: l.row, business: l.business, outcome: l.outcome, reason: l.reason })),
      });
    }
    const rows = b.records.map((r) => ({ ...clean(r), row: Math.max(2, Math.floor(Number((r as { row?: unknown })?.row) || 0)) }));
    const excluded = Array.isArray(b.excluded) ? (b.excluded as PlanLine[]).slice(0, MAX_ROWS).map((l) => ({ row: Number(l.row) || 0, business: String(l.business ?? "").slice(0, 200), outcome: (["skipped", "excluded", "rejected"].includes(String(l.outcome)) ? l.outcome : "skipped") as PlanLine["outcome"], reason: String(l.reason ?? "").slice(0, 200) })) : [];
    const r = await runImport(d, g.who.tenantId, { userId: g.who.userId, name: g.who.name || g.who.email }, rows, String(b.fileName ?? ""), {
      importId: typeof b.importId === "string" ? b.importId : undefined,
      maps: b.maps === true,
      packageForWebsite: typeof b.packageForWebsite === "string" ? b.packageForWebsite.slice(0, 120) : undefined,
      batch: b.batch === "listing" ? "listing" : "email",
      excluded,
    });
    return NextResponse.json({ ok: true, id: r.id, created: r.created, skipped: r.skipped, rejected: r.rejected });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "leads.import") }, { status: 500 });
  }
}
