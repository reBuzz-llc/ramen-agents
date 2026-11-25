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
/** A street line, not a place: a house number first ("31-15 Steinway St"), a street word last with a number in it ("Main St 12"), a suite or a unit ("#7"). A place named like a street with no number stays a place ("Bay Terrace", "St. Albans"). */
export function looksLikeStreet(part: string): boolean {
  const p = part.trim();
  return /^\d/.test(p) || (/\d/.test(p) && /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|hwy|highway|pkwy|parkway|pl|place|ct|court|way|ter|terrace|sq|square)\.?$/i.test(p)) || /^(suite|ste|unit|apt|floor|fl)\b|#\s*\d/i.test(p);
}

export function placeOf(location: string): { city: string; state: string } {
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { city: "", state: "" };
  // The state is the last later part that reads as one ("NY", "NY 11422", "New York"), skipping "Suite 704" and the like;
  // the city is the nearest place-like part before it, so a full address ("31-15 Steinway St, Astoria, NY 11103") gives Astoria, never
  // the street (the street once reached a sample's slug through the city).
  let last: { i: number; state: string } | null = null;
  for (const [i, p] of parts.entries()) {
    if (i === 0) continue;
    const word = p.replace(/\s*\d{5}(-\d{4})?$/, "").trim().toLowerCase();
    const state = STATES[word] ?? (/^[a-z]{2}$/i.test(word) && !/^(us)$/i.test(word) ? word.toUpperCase() : "");
    if (state) last = { i, state };
  }
  // the last part that reads as a state: "276 Fifth Avenue, New York, NY 10001" is New York, NY
  if (last) {
    // the nearest place before it; a state's own name ("New York") only when no other place comes first
    const before = parts.slice(0, last.i).reverse().filter((x) => !looksLikeStreet(x));
    const isState = (x: string) => !!STATES[x.replace(/\s*\d{5}(-\d{4})?$/, "").trim().toLowerCase()];
    return { city: before.find((x) => !isState(x)) ?? before[0] ?? "", state: last.state };
  }
  const city = parts.find((p) => !looksLikeStreet(p)) ?? "";
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
/** Which Leads tab an address names, read the same way on the server and in the browser. */
export function leadsTab(v: string | string[] | null | undefined): "send" | "followup" | "research" | "board" | "table" {
  return v === "board" || v === "table" || v === "research" || v === "followup" ? v : "send";
}

export const FILTER_KEYS = ["q", "email", "whatsapp", "city", "industry", "taken", "edited", "tools", "site"] as const;

/** The board's Taken by, Last edited and Tools on site filters, in place of Score, Draft email and Contact role. */
export const NOT_TAKEN = "(not taken)";
export const NO_TOOLS = "(none found)";
export const EDITED_FILTERS: [string, string][] = [
  ["today", "Today"],
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["older", "Older than 30 days"],
];

/** Was this row last edited inside the chosen period? "Today" is the calendar day on this device. */
export function editedMatches(at: string | null | undefined, pick: string, now: number): boolean {
  if (!pick) return true;
  const t = at ? new Date(at).getTime() : NaN;
  if (Number.isNaN(t)) return pick === "older";
  if (pick === "today") return new Date(t).toDateString() === new Date(now).toDateString();
  if (pick === "older") return now - t > 30 * 86400e3;
  return now - t <= Number(pick) * 86400e3;
}

export const toolsMatch = (tools: string[] | null | undefined, pick: string) => !pick || (pick === NO_TOOLS ? !tools?.length : !!tools?.includes(pick));

/** Each tool found on the board, most leads first, with how many; then the leads with none. */
export function toolOptions(rows: { toolsOnSite?: string[] | null }[]): [string, string][] {
  const m = new Map<string, number>();
  let none = 0;
  for (const r of rows) {
    if (!r.toolsOnSite?.length) none++;
    for (const t of new Set(r.toolsOnSite ?? [])) m.set(t, (m.get(t) ?? 0) + 1);
  }
  const found = [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t, n]): [string, string] => [t, `${t} (${n})`]);
  return none ? [...found, [NO_TOOLS, `${NO_TOOLS} (${none})`]] : found;
}

/** The "No website" quick filters: the businesses with no site of their own, the Starter Website
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
