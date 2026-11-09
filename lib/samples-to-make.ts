// "Samples to make" on the Clock: the team makes each sample site by hand before
// the meeting. A person sees their own leads that answered (Replied) or booked a meeting (Meeting) for the Starter
// Website package and have no Sample site yet, the longest-waiting answer first, ten at most, each with what the sample
// needs: the business, its listing or website, the pain point, and the lead to open. Pasting the link in Sample site
// takes the lead off the list.
import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "./db";
import { leads } from "./db/schema";

export const SAMPLE_PACKAGE = "Starter Website";
export const SAMPLE_RESULTS = ["Replied", "Meeting"];
export const SAMPLES_LIMIT = 10;

export type SampleToMake = { id: string; business: string; link: string | null; painPoint: string | null; result: string; resultDate: string | null; location: string | null };

export async function samplesToMake(db: Db, tenantId: string, names: string[]): Promise<SampleToMake[]> {
  if (!names.length) return [];
  const rows = await db
    .select({ id: leads.id, business: leads.business, website: leads.website, mapLink: leads.mapLink, painPoint: leads.painPoint, result: leads.result, resultDate: leads.resultDate, location: leads.location })
    .from(leads)
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.archived, false),
        sql`${leads.sentBy} && ARRAY[${sql.join(names.map((n) => sql`${n}`), sql`, `)}]::text[]`,
        inArray(leads.result, SAMPLE_RESULTS),
        ilike(leads.package, `${SAMPLE_PACKAGE}%`),
        or(isNull(leads.sampleUrl), eq(leads.sampleUrl, "")),
      ),
    )
    .orderBy(sql`${leads.resultDate} asc nulls last`, asc(leads.business))
    .limit(SAMPLES_LIMIT);
  return rows.map((r) => ({
    id: r.id,
    business: r.business,
    link: r.website || r.mapLink || null,
    painPoint: r.painPoint,
    result: r.result ?? "",
    resultDate: r.resultDate ? String(r.resultDate).slice(0, 10) : null,
    location: r.location,
  }));
}
