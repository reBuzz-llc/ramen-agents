// The public directory of sample sites: the blog's /directory lists
// every live sample site the Site Builder published, one card each. This is what leaves Peek for it, and nothing more:
// the business's name, its trade, its city and state (never the street), the Google rating and review count when the
// listing has them, the sample's own https link, and a wa.me link built from the WhatsApp cell. No email, no phone as
// text, no contact person, no notes. GET /v1/samples/directory serves it (fetched by the fleet's samples-sync.py).
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "./db";
import { leads, samples } from "./db/schema";
import { listingFacts } from "./samples";

/** The status a published sample has (the publisher sets it); everything else is listed only as gone on an update. */
export const LIVE = "live";

export type DirectoryItem = {
  id: string;
  status: string;
  business: string;
  trade: string;
  city: string | null;
  state: string | null;
  rating: number | null;
  reviews: number | null;
  url: string | null;
  whatsapp: string | null;
  updated_at: string;
};

type Lead = { business: string; city: string | null; state: string | null; whatsapp: string | null; listing: { rating?: number; reviews?: number } | null; listingEvidence: string | null };
type Sample = { id: string; status: string; template: string; url: string; updatedAt: Date };

const httpsOnly = (u: string | null | undefined) => (u && /^https:\/\/[^\s"'<>]+$/i.test(u.trim()) ? u.trim() : null);

/** A wa.me link from the WhatsApp cell (a wa.me link or a number with 8 or more digits), else null. */
export function waLinkOf(cell: string | null | undefined): string | null {
  const w = (cell ?? "").trim();
  const m = w.match(/^https:\/\/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?(\d{8,15})/i);
  const digits = m ? m[1] : w.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? `https://wa.me/${digits}` : null;
}

/** One card's facts. A sample that is not live carries its id and status only (the blog drops it). */
export function directoryItem(s: Sample, l: Lead): DirectoryItem {
  const base = { id: s.id, status: s.status, updated_at: s.updatedAt.toISOString() };
  if (s.status !== LIVE) return { ...base, business: "", trade: "", city: null, state: null, rating: null, reviews: null, url: null, whatsapp: null };
  const f = listingFacts(l.listingEvidence);
  const rating = typeof l.listing?.rating === "number" ? l.listing.rating : f.rating ? Number(f.rating) : null;
  const reviews = typeof l.listing?.reviews === "number" ? l.listing.reviews : (f.reviews ?? null);
  const clean = (v: string | null) => (v ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || null;
  return {
    ...base,
    business: (clean(l.business) ?? "").slice(0, 120),
    trade: s.template,
    city: clean(l.city),
    state: clean(l.state),
    rating: rating !== null && Number.isFinite(rating) && rating > 0 && rating <= 5 ? Math.round(rating * 10) / 10 : null,
    reviews: reviews !== null && Number.isInteger(reviews) && reviews >= 0 ? reviews : null,
    url: httpsOnly(s.url),
    whatsapp: waLinkOf(l.whatsapp),
  };
}

/** Live samples, or, with `since`, every sample changed after it (a take-down then reaches the blog as not live). */
export async function directory(d: Db, tenantId: string, since?: Date | null): Promise<DirectoryItem[]> {
  const where = [eq(samples.tenantId, tenantId)];
  if (since) where.push(gt(samples.updatedAt, since));
  else where.push(inArray(samples.status, [LIVE]));
  const rows = await d
    .select({
      id: samples.id,
      status: samples.status,
      template: samples.template,
      url: samples.url,
      updatedAt: samples.updatedAt,
      business: leads.business,
      city: leads.city,
      state: leads.state,
      whatsapp: leads.whatsapp,
      listing: leads.listing,
      listingEvidence: leads.listingEvidence,
    })
    .from(samples)
    .innerJoin(leads, and(eq(leads.id, samples.leadId), eq(leads.tenantId, samples.tenantId)))
    .where(and(...where))
    .orderBy(desc(samples.updatedAt))
    .limit(2000);
  return rows.map((r) => directoryItem(r, r));
}
