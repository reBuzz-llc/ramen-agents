// Importing leads an owner or manager gathered. The browser reads the
// CSV or spreadsheet and maps it (lib/lead-import-map.ts); here the whole file is planned in a dry run (the import
// rules, duplicates against the board and inside the file, the two batches), and then the approved rows of a batch are
// created as that person: each new lead's cells in its history with the person as actor, no email status, so the
// Enricher and the Validator treat them like any other row.
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./db";
import { leadImports, leads } from "./db/schema";
import { placeOf } from "./lead-filters";
import { HOME_STATES, SOCIAL, type MappedRow } from "./lead-import-map";
import { domainOf, writeLead } from "./leads";
import { e164 } from "./phone";
import { isFreeMailDomain } from "./already-sent";

export { autoMap, BATCH, FIELD_LABEL, IMPORT_FIELDS, isMapsExport, keyOf, listItems, mapRows, MAX_FILE_BYTES, MAX_ROWS, parseCsv, SOCIAL, type ImportField, type MappedRow } from "./lead-import-map";

const normName = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(llc|inc|ltd|corp|co|the)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const normCity = (s: string) => normName(placeOf(s).city || s);
const websiteOf = (v: string) => (/^https?:\/\//i.test(v) ? v : v ? `https://${v}` : "");
/** The row's own website, or "" when it gave a social or listing page (Instagram, Yelp, Linktree...) instead. */
export const ownWebsite = (v?: string) => {
  const w = websiteOf((v ?? "").trim());
  const d = domainOf(w);
  return d && !SOCIAL.test(d) ? w : "";
};
// A chain branch's name: the shop's name without the place after a dash ("Prism Shops - Bronx" -> "prism shops").
const brand = (name: string) => normName(name.replace(/\s+[-–|@]\s+.*$/, ""));

/** The import rules: only the states listed (null: any), CLOSED rows out, chain-like rows out (the same name or
 *  website 3 or more times in the file), and rows with no way to reach the business (no email, phone or WhatsApp) out. */
export type Rules = { states: string[] | null; skipClosed: boolean; skipChains: boolean; needContact: boolean };
export const NO_RULES: Rules = { states: null, skipClosed: false, skipChains: false, needContact: false };
export const MAPS_RULES: Rules = { states: HOME_STATES.length ? HOME_STATES : null, skipClosed: true, skipChains: true, needContact: true };

export type Batch = "email" | "listing";
export type PlanLine = { row: number; business: string; outcome: "create" | "skipped" | "excluded" | "rejected"; reason: string; batch?: Batch; existingId?: string; social?: boolean };

/** A row's state as two letters ("New York" -> NY, "New Jersey" -> NJ), from its state column, else its city. */
export const stateOf = (r: MappedRow): string => {
  const s = (r.state ?? "").trim();
  if (s) return placeOf(`x, ${s}`).state || (s.length === 2 ? s.toUpperCase() : "");
  return placeOf(r.city ?? "").state;
};

/** The dry run on the whole file. Rows count from 2 (the header is 1). In order: no name (rejected), the rules
 *  (excluded, with the reason), duplicates against the board (skipped: same website domain, else same name and city),
 *  duplicates inside the file (skipped). What is left goes in batch "email" (it has an email) or "listing" (no email:
 *  a phone or WhatsApp only, "no email, listing only"). */
export async function planImport(db: Db, tenantId: string, rows: MappedRow[], rules: Rules = NO_RULES): Promise<PlanLine[]> {
  const existing = await db.select({ id: leads.id, business: leads.business, domain: leads.domain, city: leads.city }).from(leads).where(eq(leads.tenantId, tenantId));
  const byDomain = new Map(existing.filter((l) => l.domain).map((l) => [l.domain!, l]));
  const byName = new Map(existing.map((l) => [`${normName(l.business)}|${normName(l.city ?? "")}`, l]));
  // chains: the same brand name or own-website domain 3 or more times in the file
  const brands = new Map<string, number>();
  const domains = new Map<string, number>();
  for (const r of rows) {
    if (r.business) brands.set(brand(r.business), (brands.get(brand(r.business)) ?? 0) + 1);
    const d = domainOf(ownWebsite(r.website));
    if (d) domains.set(d, (domains.get(d) ?? 0) + 1);
  }
  const seenDomain = new Map<string, number>();
  const seenName = new Map<string, number>();
  return rows.map((r, i) => {
    const row = i + 2;
    const business = (r.business ?? "").trim();
    if (!business) return { row, business: "", outcome: "rejected", reason: "no business name" };
    const site = ownWebsite(r.website);
    const domain = domainOf(site);
    const social = !!r.website && !site;
    if (rules.states && !rules.states.includes(stateOf(r))) return { row, business, outcome: "excluded", reason: `outside ${rules.states.join(" and ")}` };
    if (rules.skipClosed && /closed/i.test(r.status ?? "")) return { row, business, outcome: "excluded", reason: "closed" };
    if (rules.skipChains && ((brands.get(brand(business)) ?? 0) >= 3 || (domain && (domains.get(domain) ?? 0) >= 3))) return { row, business, outcome: "excluded", reason: "a chain (3 or more branches in the file)" };
    if (rules.needContact && !r.business_email && !r.phone && !r.whatsapp) return { row, business, outcome: "excluded", reason: "neither an email nor a phone" };
    const nameKey = `${normName(business)}|${normCity(r.city ?? "")}`;
    if (domain) {
      const on = byDomain.get(domain);
      if (on) return { row, business, outcome: "skipped", reason: `already on the board (same website, ${domain}): ${on.business}`, existingId: on.id };
      if (seenDomain.has(domain)) return { row, business, outcome: "skipped", reason: `same website as row ${seenDomain.get(domain)} of this file` };
      seenDomain.set(domain, row);
    } else {
      const on = byName.get(nameKey);
      if (on) return { row, business, outcome: "skipped", reason: `already on the board (same name and city): ${on.business}`, existingId: on.id };
      if (seenName.has(nameKey)) return { row, business, outcome: "skipped", reason: `same name and city as row ${seenName.get(nameKey)} of this file` };
    }
    seenName.set(nameKey, row);
    return { row, business, outcome: "create", reason: "", batch: r.business_email ? "email" : "listing", social };
  });
}

const num = (v?: string) => {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return v && Number.isFinite(n) ? n : undefined;
};

export type FieldOpts = { foundBy: string; maps?: boolean; packageForWebsite?: string; listingOnly?: boolean };

/** A mapped row as the board's fields. The own website only (a social or listing page goes to Source pages); location
 *  "<city>, <state>, USA" ("Brooklyn, NY, USA", "Newark, NJ, USA"); the street address; the map link; the map listing's facts
 *  as one JSON cell for the Lead score; Evidence = the own website, else the map link; the package for rows with a
 *  website when one is given; a "no email, listing only" note for the second batch. */
export function leadFields(r: MappedRow, o: FieldOpts): Record<string, unknown> {
  const site = ownWebsite(r.website);
  const social = r.website && !site ? websiteOf(r.website.trim()) : "";
  const mapLink = r.map_link && /^https?:\/\//i.test(r.map_link) ? r.map_link : "";
  const listing = { rating: num(r.rating), reviews: num(r.reviews), price_range: r.price_range || undefined, place_id: r.place_id || undefined };
  const hasListing = Object.values(listing).some((v) => v !== undefined);
  const st = stateOf(r);
  const location = r.city && st ? `${placeOf(r.city).city || r.city.trim()}, ${st}, USA` : [r.city, r.state].filter(Boolean).join(", ");
  const notes = [o.listingOnly ? "No email, listing only." : "", r.notes ?? ""].filter(Boolean).join(" ");
  return {
    business: r.business,
    website: site || null,
    source_pages: [social, mapLink].filter(Boolean).join("\n") || null,
    business_email: r.business_email,
    whatsapp: r.whatsapp,
    phone: r.phone ? e164(r.phone) : r.phone,
    location: location || null,
    address: r.address,
    industry: r.industry,
    contact_person: r.contact_person,
    contact_role: r.contact_role,
    map_link: mapLink || null,
    evidence: site || mapLink || null,
    package: site && o.packageForWebsite ? o.packageForWebsite : null,
    listing: hasListing ? JSON.parse(JSON.stringify(listing)) : null,
    notes: notes || null,
    found_by: o.foundBy,
  };
}

/** The website a business email points at: https://<domain> for an address on the business's own domain, "" for a
 *  free or shared mailbox (gmail, yahoo, outlook, an internet provider's, a school's or government's). */
export function websiteFromEmail(email?: string | null): string {
  const m = /^[^@\s]+@([a-z0-9.-]+\.[a-z]{2,})$/i.exec((email ?? "").trim());
  if (!m) return "";
  const domain = m[1].toLowerCase().replace(/^www\./, "");
  return isFreeMailDomain(domain) ? "" : `https://${domain}`;
}
/** History's mark on a website taken from the email's domain: the write's "via". */
export const EMAIL_DOMAIN_VIA = "website from the email's domain, import";

/** The found_by of an import, always starting "import:": "import:
 *  google maps <date>" for a Maps export, else "import: owner file <date>". */
export const foundByOf = (maps: boolean, now: Date) => `import: ${maps ? "google maps" : "owner file"} ${now.toISOString().slice(0, 10)}`;

/** One batch of the import (the page sends up to 500 approved rows at a time, each with its row number in the file):
 *  each made as the person (a duplicate since the dry run is skipped, never doubled), and the report kept: a new import
 *  record, or appended to `importId` from the batch before. */
export async function runImport(
  db: Db,
  tenantId: string,
  who: { userId: string; name: string },
  rows: (MappedRow & { row: number })[],
  fileName: string,
  opts: { now?: Date; importId?: string; maps?: boolean; packageForWebsite?: string; batch?: Batch; excluded?: PlanLine[] } = {},
) {
  const now = opts.now ?? new Date();
  const foundBy = foundByOf(!!opts.maps, now);
  const report: PlanLine[] = [];
  for (const r of rows) {
    const business = (r.business ?? "").trim();
    if (!business) {
      report.push({ row: r.row, business: "", outcome: "rejected", reason: "no business name" });
      continue;
    }
    const w = await writeLead(db, tenantId, {}, leadFields(r, { foundBy, maps: opts.maps, packageForWebsite: opts.packageForWebsite, listingOnly: opts.batch === "listing" }), { kind: "person", name: who.name, userId: who.userId }, { create: true });
    // no website in the file, a business address on its own domain: the website from that domain, as its own History
    // entry (so a person's correction wins and the Enricher may correct it), filling only an empty cell
    const guess = w.ok && !ownWebsite(r.website) ? websiteFromEmail(r.business_email) : "";
    if (w.ok && guess) await writeLead(db, tenantId, { id: w.lead.id }, { website: guess }, { kind: "bot", name: "Import", via: EMAIL_DOMAIN_VIA }, { fillOnly: true });
    if (w.ok) report.push({ row: r.row, business, outcome: "create", reason: opts.batch === "listing" ? "created (no email, listing only)" : "created", existingId: w.lead.id, batch: opts.batch });
    else report.push({ row: r.row, business, outcome: w.code === "duplicate_row" ? "skipped" : "rejected", reason: w.message, existingId: w.existingId });
  }
  // the dry run's exclusions and duplicates go into the report once, with the first batch
  const all = [...(opts.excluded ?? []), ...report];
  const count = (o: PlanLine["outcome"]) => all.filter((l) => l.outcome === o).length;
  const lines = all.map((l) => ({ row: l.row, business: l.business, outcome: l.outcome, reason: l.reason, leadId: l.existingId }));
  let id = opts.importId;
  const [prev] = id && /^[0-9a-f-]{36}$/i.test(id) ? await db.select().from(leadImports).where(and(eq(leadImports.tenantId, tenantId), eq(leadImports.id, id))) : [];
  if (prev) {
    await db
      .update(leadImports)
      .set({ created: prev.created + count("create"), skipped: prev.skipped + count("skipped") + count("excluded"), rejected: prev.rejected + count("rejected"), report: [...prev.report, ...lines] })
      .where(eq(leadImports.id, prev.id));
  } else {
    const [saved] = await db
      .insert(leadImports)
      .values({ tenantId, byUserId: who.userId, byName: who.name, fileName: fileName.slice(0, 200), at: now, created: count("create"), skipped: count("skipped") + count("excluded"), rejected: count("rejected"), report: lines })
      .returning();
    id = saved.id;
  }
  return { id: id!, created: report.filter((l) => l.outcome === "create").length, skipped: report.filter((l) => l.outcome === "skipped").length, rejected: report.filter((l) => l.outcome === "rejected").length, report };
}

/** The recent imports for the Validator (GET /v1/imports): who, when, the counts, and the leads each created, so it can
 *  list them for the Enricher. */
export async function recentImports(db: Db, tenantId: string, limit = 20) {
  const rows = await db.select().from(leadImports).where(eq(leadImports.tenantId, tenantId)).orderBy(desc(leadImports.at)).limit(limit);
  return rows.map((i) => ({
    id: i.id,
    at: i.at.toISOString(),
    by: i.byName,
    file: i.fileName,
    created: i.created,
    skipped: i.skipped,
    rejected: i.rejected,
    created_ids: i.report.filter((l) => l.outcome === "create" && l.leadId).map((l) => l.leadId!),
  }));
}

/** A kept import's report as CSV: row, business, outcome, reason. */
export async function importReportCsv(db: Db, tenantId: string, id: string): Promise<{ name: string; csv: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [imp] = await db.select().from(leadImports).where(and(eq(leadImports.tenantId, tenantId), eq(leadImports.id, id)));
  if (!imp) return null;
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["row", "business", "outcome", "reason"].join(","), ...[...imp.report].sort((a, b) => a.row - b.row).map((l) => [l.row, q(l.business), l.outcome === "create" ? "created" : l.outcome, q(l.reason)].join(","))];
  return { name: `lead-import-${imp.at.toISOString().slice(0, 10)}.csv`, csv: lines.join("\n") + "\n" };
}
