// The Leads board as plain rows, whichever store holds it: Notion's page properties or the team portal's API leads
// become one shape, so the Reports pipeline and The CEO's measure count the same way from both. Pure,
// no imports: the tests load it as it is.

export type LeadRow = {
  business: string;
  website: string;
  industry: string;
  result: string;
  resultDate: string;
  /** Notion's Status values (a multi-select mixing two tracks); from the portal, its email and WhatsApp status together. */
  status: string[];
  draftEmail: string;
  draftWhatsapp: string;
  whatsapp: string;
  mapLink: string;
  /** When the row last changed (Notion's last_edited_time, the portal's updated_at). */
  edited: string;
  /** Which of the optional columns the source has: Notion boards gained them over time; the portal has them all. */
  has: { result: boolean; whatsapp: boolean; draftWhatsapp: boolean; mapLink: boolean; draftColumn: boolean };
};

type Prop = Record<string, unknown> | undefined;

/** One Notion property as text: select / status names, a multi-select's names joined by ", ", url, email, date, text. */
export function notionText(p: Prop): string {
  if (!p) return "";
  const t = p.type as string;
  const v = p[t] as unknown;
  if (t === "select" || t === "status") return String((v as { name?: string } | null)?.name ?? "");
  if (t === "multi_select") return ((v as { name?: string }[] | null) ?? []).map((x) => String(x?.name ?? "")).filter(Boolean).join(", ");
  if (t === "url" || t === "email") return String(v ?? "");
  if (t === "date") return String((v as { start?: string } | null)?.start ?? "");
  if (Array.isArray(v)) return v.map((x) => String((x as { plain_text?: string }).plain_text ?? "")).join("");
  return "";
}

/** A Notion page (its properties and last edit) as a row. `draftColumn` is the Outreach Writer's queue column name. */
export function fromNotion(props: Record<string, Prop>, edited = "", draftColumn = "Draft email"): LeadRow {
  const t = (name: string) => notionText(props[name]);
  const status = t("Status")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    business: t("Business"),
    website: t("Website"),
    industry: t("Industry"),
    result: t("Result"),
    resultDate: t("Result date"),
    status,
    draftEmail: t(draftColumn),
    draftWhatsapp: t("Draft Whatsapp msg"),
    whatsapp: t("Whatsapp"),
    mapLink: t("google map location"),
    edited,
    has: { result: "Result" in props, whatsapp: "Whatsapp" in props, draftWhatsapp: "Draft Whatsapp msg" in props, mapLink: "google map location" in props, draftColumn: draftColumn in props },
  };
}

/** A lead from the portal's API (GET /v1/boards/leads/rows) as a row. */
export function fromPortal(l: Record<string, unknown>): LeadRow {
  const s = (k: string) => (l[k] === null || l[k] === undefined ? "" : String(l[k]));
  return {
    business: s("business"),
    website: s("website"),
    industry: s("industry"),
    result: s("result"),
    resultDate: s("result_date"),
    status: [s("email_status"), s("whatsapp_status")].filter(Boolean),
    draftEmail: s("draft_email"),
    draftWhatsapp: s("draft_whatsapp"),
    whatsapp: s("whatsapp"),
    mapLink: s("map_link"),
    edited: s("updated_at"),
    has: { result: true, whatsapp: true, draftWhatsapp: true, mapLink: true, draftColumn: true },
  };
}

export const isSent = (r: LeadRow) => r.status.includes("Email Sent");
export const isSkip = (d: string) => /^skip\s*:/i.test(d.trim());

// The board's Industry cell is free text ("Restaurant", "Food & Beverage", "Educational Support Services"): a few plain
// groups so the same trade is counted once. First match wins; anything else is "Other", an empty cell "Unknown".
const INDUSTRY_GROUPS: [string, RegExp][] = [
  ["Franchises and chains", /^franchise|franchis/i],
  ["Food and drink", /restaurant|food|cafe|café|coffee|bakery|baked|catering|beverage|\bbar\b|eatery|pizza|deli|grill|kitchen|dessert|juice|wine|liquor/i],
  ["Beauty and fitness", /salon|hair|beauty|spa\b|nail|barber|gym|fitness|yoga|pilates|massage|skin|facial|wellness club/i],
  ["Health and care", /health|clinic|dental|medical|therap|counsel|care\b|senior|pharma|doctor|surgery|wellness|mental|pediatric|podiat|optometr|physician|speech|patholog/i],
  ["Education and childcare", /educat|school|tutor|child|learning|academy|music|dance|kids|camp|daycare|youth|sport|soccer|golf|coach/i],
  ["Events, arts and media", /event|party|production|film|photo|media|studio|\bart|gallery|entertain|theater|theatre|creative/i],
  ["Professional services", /consult|law|legal|account|insurance|financ|real estate|marketing|agency|management|staffing|security|business|engineer|architect|public relations|printing|property|vending|\bmbe\b/i],
  ["Home and trades", /construct|contract|plumb|electric|clean|pest|hardware|repair|home|roof|hvac|landscap|moving|develop|tint|wash/i],
  ["Shops", /store|shop|retail|boutique|apparel|fashion|gift|florist|flower|jewel|supplies/i],
];
export function industryGroup(raw: string): string {
  const s = raw.trim();
  if (!s) return "Unknown";
  return INDUSTRY_GROUPS.find(([, re]) => re.test(s))?.[0] ?? "Other";
}

// The furthest a lead got: a client was also emailed, replied and met.
const RANK: Record<string, number> = { Emailed: 1, Replied: 2, Meeting: 3, Client: 4 };

export type ResultGroup = { label: string; leads: number; drafted: number; sent: number; replied: number; meeting: number; client: number };
export type Pipeline = Omit<ResultGroup, "label">;
export type DraftCounts = { column: string; stage: string; drafted: number; skipped: number; waiting: number; unsent: number };
export type Summary = {
  total: number;
  pipeline: Pipeline;
  bySource: ResultGroup[];
  byIndustry: ResultGroup[];
  drafts: DraftCounts | null;
  whatsapp: number | null;
  whatsappDrafts: number | null;
  mapLinks: number | null;
  whatsappVerified: number;
  sent: number;
  repliesWeek: number;
};

/** The Reports pipeline from plain rows: per source and industry, how far the leads got (drafted, sent, answered, met,
 *  won; each step counts those that reached it or went further), the Outreach Writer's drafts, WhatsApp and map counts,
 *  and the team's sending this week. `sourceOf` names where a row came from. */
export function summarise(rows: LeadRow[], sourceOf: (r: LeadRow) => string, column = "Draft email", now = Date.now()): Summary {
  const zero = (): Pipeline => ({ leads: 0, drafted: 0, sent: 0, replied: 0, meeting: 0, client: 0 });
  const pipeline = zero();
  const bump = (g: Pipeline, r: LeadRow) => {
    const rank = RANK[r.result] ?? (r.result === "Not interested" ? 2 : r.result === "Bounced" ? 1 : 0);
    const draft = r.draftEmail.trim();
    g.leads++;
    if ((draft && !isSkip(draft)) || rank || isSent(r)) g.drafted++;
    if (rank >= 1 || isSent(r)) g.sent++;
    if (rank >= 2) g.replied++;
    if (rank >= 3) g.meeting++;
    if (rank >= 4) g.client++;
  };
  const groups = { source: new Map<string, ResultGroup>(), industry: new Map<string, ResultGroup>() };
  const add = (map: Map<string, ResultGroup>, label: string, r: LeadRow) => {
    const g = map.get(label) ?? { label, ...zero() };
    bump(g, r);
    map.set(label, g);
  };
  for (const r of rows) {
    bump(pipeline, r);
    add(groups.source, sourceOf(r), r);
    add(groups.industry, industryGroup(r.industry), r);
  }
  let drafts: DraftCounts | null = null;
  if (rows.some((r) => r.has.draftColumn)) {
    drafts = { column, stage: "", drafted: 0, skipped: 0, waiting: 0, unsent: 0 };
    for (const r of rows) {
      const d = r.draftEmail.trim();
      const open = !isSent(r) && !r.result;
      if (isSkip(d)) drafts.skipped++;
      else if (d) {
        drafts.drafted++;
        if (open) drafts.unsent++;
      } else if (open) drafts.waiting++;
    }
  }
  const weekAgo = new Date(now - 7 * 86400e3).toISOString().slice(0, 10);
  const answered = new Set(["Replied", "Meeting", "Client", "Not interested"]);
  const sort = (m: Map<string, ResultGroup>) => [...m.values()].sort((a, b) => b.leads - a.leads);
  return {
    total: rows.length,
    pipeline,
    bySource: sort(groups.source),
    byIndustry: sort(groups.industry),
    drafts,
    whatsapp: rows.some((r) => r.has.whatsapp) ? rows.filter((r) => r.whatsapp.trim()).length : null,
    whatsappDrafts: rows.some((r) => r.has.draftWhatsapp) ? rows.filter((r) => r.draftWhatsapp.trim() && !isSkip(r.draftWhatsapp)).length : null,
    mapLinks: rows.some((r) => r.has.mapLink) ? rows.filter((r) => r.mapLink.trim()).length : null,
    whatsappVerified: rows.filter((r) => r.status.includes("WhatsApp Verified")).length,
    sent: rows.filter(isSent).length,
    repliesWeek: rows.filter((r) => answered.has(r.result) && r.resultDate.slice(0, 10) >= weekAgo).length,
  };
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The cells the dashboard reads from a portal lead (fromPortal): asked for by name, so nothing else travels. */
export const PORTAL_FIELDS = "business,website,industry,result,result_date,email_status,whatsapp_status,draft_email,draft_whatsapp,whatsapp,map_link";

export type PortalCache = { url: string; rev: number; fullAt: string; etag: string; leads: Record<string, Record<string, unknown>> };

/** The board from a cache kept on this Mac: only the
 *  leads changed since the cache's rev travel (archived ones too, so an archived lead leaves the cache); the first page
 *  carries the last ETag, and a 304 means nothing changed and nothing is pulled. A full pull once a day (or for a new
 *  url, or no cache). Returns the live leads and the cache to save. */
export async function readPortalCached(url: string, key: string, cache: PortalCache | null, now = Date.now(), fetchFn: Fetch = fetch): Promise<{ leads: Record<string, unknown>[]; cache: PortalCache; pulled: number }> {
  const full = !cache || cache.url !== url || now - new Date(cache.fullAt).getTime() > 24 * 3600e3;
  const leads: Record<string, Record<string, unknown>> = full ? {} : { ...cache!.leads };
  let since = full ? 0 : cache!.rev;
  let etag = full ? "" : cache!.etag;
  let pulled = 0;
  for (let i = 0; i < 40; i++) {
    const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
    if (i === 0 && etag) headers["If-None-Match"] = etag;
    const res = await fetchFn(`${url}/v1/boards/leads/rows?since=${since}&limit=500&archived=true&fields=${PORTAL_FIELDS}`, { headers, signal: AbortSignal.timeout(20000) });
    if (res.status === 304) break;
    const body = (await res.json().catch(() => null)) as { leads?: Record<string, unknown>[]; next?: number; more?: boolean; error?: { message?: string } } | null;
    if (!res.ok || !body) throw new Error(`The portal answered HTTP ${res.status}${body?.error?.message ? `: ${body.error.message}` : ""}`);
    if (i === 0) etag = res.headers.get("etag") ?? "";
    for (const l of body.leads ?? []) {
      pulled++;
      const id = String(l.id ?? "");
      if (!id) continue;
      if (l.archived) delete leads[id];
      else leads[id] = l;
    }
    if (!body.more) {
      since = Number(body.next ?? since);
      break;
    }
    since = Number(body.next);
  }
  const next: PortalCache = { url, rev: since, fullAt: full ? new Date(now).toISOString() : cache!.fullAt, etag, leads };
  return { leads: Object.values(leads), cache: next, pulled };
}

/** Every lead, in rev order, page by page (?since=<rev>&limit=500 until `more` is false). Throws with a message the
 *  Reports page can show. */
export async function readAllPortal(url: string, key: string, fetchFn: Fetch = fetch): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let since = 0;
  for (let i = 0; i < 40; i++) {
    const res = await fetchFn(`${url}/v1/boards/leads/rows?since=${since}&limit=500`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
    const body = (await res.json().catch(() => null)) as { leads?: Record<string, unknown>[]; next?: number; more?: boolean; error?: { message?: string } } | null;
    if (!res.ok || !body) throw new Error(`The portal answered HTTP ${res.status}${body?.error?.message ? `: ${body.error.message}` : ""}`);
    out.push(...(body.leads ?? []));
    if (!body.more) break;
    since = Number(body.next);
  }
  return out;
}

