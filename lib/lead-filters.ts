// Filters on Our queue, so each person can work a niche: an industry group, a place, a package, a score band, how the
// lead can be reached, whose it is, how new it is, or a word. Industry is free text on the board (240 values for 280
// rows), so it is grouped by keywords (the dashboard's groups); a place is read from "City, State, Country".
// Pure functions, tested; the page keeps the choices in its URL so a filtered view can be shared.

const INDUSTRY_GROUPS: [string, RegExp][] = [
  ["Franchises and chains", /^franchise|franchis/i],
  ["Food and drink", /restaurant|food|cafe|café|coffee|bakery|baked|catering|beverage|\bbar\b|eatery|pizza|deli|grill|kitchen|dessert|juice|wine|liquor/i],
  ["Beauty and fitness", /salon|hair|beauty|spa\b|nail|barber|gym|fitness|yoga|pilates|massage|skin|facial|wellness club/i],
  ["Health and care", /health|clinic|dental|medical|therap|counsel|care\b|senior|pharma|doctor|surgery|wellness|mental|pediatric|podiat|optometr|physician|speech|patholog/i],
  ["Education and childcare", /educat|school|tutor|child|learning|academy|music|dance|kids|camp|daycare|youth|sport|soccer|golf|coach/i],
  ["Events, arts and media", /event|party|production|film|photo|media|studio|\bart|gallery|entertain|theater|theatre|creative|artist|writer|perform/i],
  ["Professional services", /consult|law|legal|account|insurance|financ|real estate|marketing|agency|management|staffing|security|business|engineer|architect|public relations|printing|property|vending|\bmbe\b/i],
  ["Home and trades", /construct|contract|plumb|electric|clean|pest|hardware|repair|home|roof|hvac|landscap|moving|develop|tint|wash|furniture/i],
  ["Shops", /store|shop|retail|boutique|apparel|fashion|gift|florist|flower|jewel|supplies/i],
];

export function industryGroup(raw: string): string {
  const s = raw.trim();
  if (!s) return "Unknown";
  return INDUSTRY_GROUPS.find(([, re]) => re.test(s))?.[0] ?? "Other";
}

const STATES: Record<string, string> = { "new york": "NY", "n.y.": "NY", ny: "NY", california: "CA", florida: "FL", michigan: "MI", "new jersey": "NJ", texas: "TX", "united kingdom": "UK", england: "UK" };
const NYC = /^(brooklyn|queens|manhattan|bronx|the bronx|staten island|new york|new york city|nyc|ridgewood|astoria|flushing|jamaica|long island city)$/i;

/** "Brooklyn, NY 11220, USA" → { city: "Brooklyn", state: "NY" }. A missing or unreadable part is "". */
export function placeOf(location: string): { city: string; state: string } {
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { city: "", state: "" };
  const city = parts[0];
  // The state is the first later part that reads as one ("NY", "NY 11422", "New York"), skipping "Suite 704" and the like.
  for (const p of parts.slice(1)) {
    const word = p.replace(/\s*\d{5}(-\d{4})?$/, "").trim().toLowerCase();
    if (STATES[word]) return { city, state: STATES[word] };
    if (/^[a-z]{2}$/i.test(word) && !/^(us)$/i.test(word)) return { city, state: word.toUpperCase() };
  }
  return { city, state: NYC.test(city) ? "NY" : "" };
}

export type Filters = {
  q: string; // a word in the business, contact, email, industry or city
  industry: string; // an industry group
  state: string;
  city: string;
  pkg: string; // "How can I help"
  score: "" | "50" | "70" | "85" | "none";
  reach: "" | "email" | "whatsapp" | "contact";
  who: "" | "mine" | "open" | "others";
  added: "" | "7" | "30";
};

export const NO_FILTERS: Filters = { q: "", industry: "", state: "", city: "", pkg: "", score: "", reach: "", who: "", added: "" };

export type Filterable = {
  business: string;
  contact: string;
  email: string;
  whatsapp: string;
  industry: string;
  location: string;
  pkg: string;
  score: number | null;
  created: string;
  takenBy: { mine: boolean } | null;
};

export function matches(r: Filterable, f: Filters, now = Date.now()): boolean {
  const place = placeOf(r.location);
  if (f.industry && industryGroup(r.industry) !== f.industry) return false;
  if (f.state && (place.state || "Unknown") !== f.state) return false;
  if (f.city && place.city !== f.city) return false;
  if (f.pkg && r.pkg !== f.pkg) return false;
  if (f.score === "none" ? r.score !== null : f.score && (r.score ?? -1) < Number(f.score)) return false;
  if (f.reach === "email" && !r.email) return false;
  if (f.reach === "whatsapp" && (r.email || !r.whatsapp)) return false;
  if (f.reach === "contact" && !r.contact) return false;
  if (f.who === "mine" && !r.takenBy?.mine) return false;
  if (f.who === "open" && r.takenBy) return false;
  if (f.who === "others" && (!r.takenBy || r.takenBy.mine)) return false;
  if (f.added && (!r.created || now - new Date(r.created).getTime() > Number(f.added) * 86400e3)) return false;
  if (f.q) {
    const hay = `${r.business} ${r.contact} ${r.email} ${r.industry} ${r.location}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
  }
  return true;
}

/** The choices for a select, most rows first, each with its count. */
export function choices<T>(rows: T[], key: (r: T) => string): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Filters to and from the page's URL (?industry=...&score=70), leaving out the empty ones. */
export function filtersFrom(params: URLSearchParams): Filters {
  const f = { ...NO_FILTERS };
  for (const k of Object.keys(f) as (keyof Filters)[]) (f as Record<string, string>)[k] = params.get(k) ?? "";
  return f;
}
export function filtersToQuery(f: Filters): string {
  const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The Leads page's filters read from the address (?whatsapp=…, ?city=…): one list for the server page and the client
 *  view. It lives here, not in the client view: a server component that imports a plain value from a "use client" file
 *  gets a client reference, not the array (FILTER_KEYS.map is not a function: the filters in a link were ignored). */
export const FILTER_KEYS = ["q", "email", "whatsapp", "city", "industry", "score", "draft", "role", "site"] as const;

/** The "No website" quick filters: the businesses with no site of their own, the website
 *  pitch; "none-wa" keeps those with a WhatsApp number, the channel that pitch goes out on. An empty or blank website
 *  cell is no website. */
export type SiteFilter = "" | "none" | "none-wa";
export const SITE_FILTERS: [Exclude<SiteFilter, "">, string][] = [
  ["none", "No website"],
  ["none-wa", "No website, has WhatsApp"],
];
export const hasNoWebsite = (website: string | null | undefined) => !website?.trim();
export function siteMatches(r: { website: string | null; hasWhatsapp: boolean }, site: string): boolean {
  if (site === "none") return hasNoWebsite(r.website);
  if (site === "none-wa") return hasNoWebsite(r.website) && r.hasWhatsapp;
  return true;
}
