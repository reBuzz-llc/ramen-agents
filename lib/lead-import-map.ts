// Reading an import file into the board's fields: the browser side, no database, so the page can
// map a 5 MB export itself and send only what the board keeps. It knows the usual spreadsheet headers and the Google
// Maps business export (name, category, phone, email, emails, website, address, city, state, rating, review_count,
// price_range, place_id, location_link, categories, description, ...): see autoMap.

/** The fields a column can map to, in the order the page lists them. */
export const IMPORT_FIELDS = [
  "business",
  "website",
  "business_email",
  "emails",
  "whatsapp",
  "phone",
  "address",
  "city",
  "state",
  "industry",
  "categories",
  "contact_person",
  "contact_role",
  "map_link",
  "rating",
  "reviews",
  "price_range",
  "place_id",
  "status",
  "notes",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const FIELD_LABEL: Record<ImportField, string> = {
  business: "Business name",
  website: "Website",
  business_email: "Email",
  emails: "Other emails (used when Email is empty)",
  whatsapp: "WhatsApp",
  phone: "Phone",
  address: "Street address",
  city: "City / borough",
  state: "State",
  industry: "Industry",
  categories: "Other categories (used when Industry is empty)",
  contact_person: "Contact person",
  contact_role: "Contact role",
  map_link: "Map link",
  rating: "Rating",
  reviews: "Review count",
  price_range: "Price range",
  place_id: "Place ID",
  status: "Business status (CLOSED rows can be left out)",
  notes: "Notes",
};
export const MAX_ROWS = 10000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const BATCH = 500;

const SYNONYMS: Record<ImportField, RegExp> = {
  business: /^(business|business ?name|company|company ?name|name|shop|store|restaurant|organi[sz]ation)$/,
  website: /^(website|web ?site|url|site|web|homepage|domain)$/,
  business_email: /^(e ?mail|e ?mail ?address|business ?e ?mail|mail|contact ?e ?mail)$/,
  emails: /^(e ?mails|other ?e ?mails|all ?e ?mails)$/,
  whatsapp: /^(whats ?app|wa|whatsapp ?(number|link)?)$/,
  phone: /^(phone|phone ?number|tel|telephone|mobile|cell|contact ?number|number)$/,
  address: /^(address|street|street ?address|full ?address)$/,
  city: /^(city|borough|town|area|location|neighbou?rhood)$/,
  state: /^(state|region|province)$/,
  industry: /^(industry|category|type|sector|business ?type|niche)$/,
  categories: /^(categories|other ?categories|subcategories)$/,
  contact_person: /^(contact|contact ?(person|name)|owner|owner ?name|person|full ?name|first ?name)$/,
  contact_role: /^(role|title|position|job ?title|contact ?role)$/,
  map_link: /^(location ?link|map|map ?link|maps ?url|google ?maps|google ?maps ?url|place ?url)$/,
  rating: /^(rating|stars|average ?rating)$/,
  reviews: /^(review ?count|reviews|reviews ?count|number ?of ?reviews|ratings ?count)$/,
  price_range: /^(price ?range|price ?level|price)$/,
  place_id: /^(place ?id|google ?place ?id)$/,
  status: /^(status|business ?status)$/,
  notes: /^(notes?|comments?|remarks?|description|details|memo|about)$/,
};

/** Each header's field (or null to skip it), by its name; a field is taken by its first matching column only. */
export function autoMap(headers: string[]): (ImportField | null)[] {
  const taken = new Set<ImportField>();
  return headers.map((h) => {
    const k = h.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");
    const hit = IMPORT_FIELDS.find((f) => !taken.has(f) && SYNONYMS[f].test(k));
    if (hit) taken.add(hit);
    return hit ?? null;
  });
}

/** A CSV text as rows of cells: quotes, doubled quotes, commas or semicolons (whichever the first line uses), new lines
 *  inside quotes, a BOM, and CRLF; blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export type MappedRow = Partial<Record<ImportField, string>>;

/** A list cell ("['a@b.com', 'c@d.com']", '["Bakery", "Cafe"]', "a@b.com; c@d.com") as its items. */
export function listItems(v: string): string[] {
  return v
    .replace(/^\s*\[|\]\s*$/g, "")
    .split(/[,;|]/)
    .map((x) => x.trim().replace(/^['"]|['"]$/g, "").trim())
    .filter(Boolean);
}
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The data rows (after the header) as fields, by the confirmed mapping; cells trimmed, empty ones left out. The email
 *  falls back to the first address in "Other emails", the industry to the first of "Other categories"; a list in
 *  either is reduced to its first item. */
export function mapRows(rows: string[][], mapping: (ImportField | null)[]): MappedRow[] {
  return rows.map((r) => {
    const out: MappedRow = {};
    mapping.forEach((f, i) => {
      const v = String(r[i] ?? "").trim();
      if (f && v && !out[f]) out[f] = v.slice(0, 2000);
    });
    const email = [out.business_email, ...listItems(out.emails ?? "")].map((e) => (e ? listItems(e)[0] : "")).find((e) => e && EMAIL.test(e));
    if (email) out.business_email = email;
    else delete out.business_email;
    const industry = listItems(out.industry ?? "")[0] ?? listItems(out.categories ?? "")[0];
    if (industry) out.industry = industry;
    delete out.emails;
    delete out.categories;
    return out;
  });
}

/** What the dry run needs of a row: enough to place it, find duplicates and chains, and sort it into its batch. */
export const keyOf = (r: MappedRow): MappedRow => ({
  business: r.business,
  website: r.website,
  city: r.city,
  state: r.state,
  status: r.status ? r.status.slice(0, 40) : undefined,
  business_email: r.business_email ? "1" : undefined,
  phone: r.phone ? "1" : undefined,
  whatsapp: r.whatsapp ? "1" : undefined,
});

/** A Google Maps business export (it has a place id and a location link): the import rules default on for it. */
export const isMapsExport = (mapping: (ImportField | null)[]) => mapping.includes("place_id") && mapping.includes("map_link");

/** Pages that are not a business's own website: they go to Source pages, never into Website. */
export const SOCIAL = /(^|\.)(facebook|fb|instagram|twitter|x|tiktok|linkedin|youtube|pinterest|yelp|linktr|linktree|beacons|tripadvisor|google|goo|maps\.app|business\.site|squareup|square\.site|ubereats|doordash|grubhub|seamless|etsy|amazon|ebay|depop|poshmark|shopify\.com|wix\.com|whatsapp|wa)\.[a-z.]+$/i;

/** The states a Google Maps import keeps by default: NEXT_PUBLIC_HOME_STATES, two-letter codes with commas ("NY,NJ"); none
 *  set means any state. */
export const HOME_STATES = (process.env.NEXT_PUBLIC_HOME_STATES ?? "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x));
