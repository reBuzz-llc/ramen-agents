import { agentName } from "./agent-names";
// Sample sites (plan: docs/design/sample-sites.md). The Site Builder agent
// sends only the copy -- a headline, an intro, an optional "what we noticed" line, two or three short sections and the
// call-to-action label; renderSample() builds the page from the lead's own row (name, trade, area, the Google listing's
// rating, reviews and opening days with its Maps link, the WhatsApp button) and one of five trade templates. The facts
// never come from the model, and the copy is checked here before anything is stored: no web address, email, phone,
// price, quoted review, person's name or "best in town" claim. Inline CSS, no script, noindex, a footer that says what
// the page is. Pure functions first, the database after.
//
// The production line (the Validator's design): five template families (eat, shop, services, care, plain;
// the five older template names are read as their family), copy v3 {headline, about, cta} beside the older shape, the
// pain point's first line picking the page's lead section (its angle), SB05 (a number, year or "family-owned"-type claim
// only when the row says it) and SB06 (never a place the team works from). A sample row is always the current version:
// each re-render or new draft copies the one it replaces to sample_versions first. A facts change on the lead (address,
// phone, WhatsApp, website, social links, map, listing) re-renders the page with the same copy at once, no model call; a
// change of the name, pain point or listing kind lists the lead as "recopy" in the Site Builder's queue. At Replied or
// Meeting the sample is frozen (frozen_at): no automatic rebuild after that, and a person's note asks for the next version.
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "./db";
import { listRates } from "./assets";
import { leadPath } from "./deep-links";
import { looksLikeStreet } from "./lead-filters";
import { syncLeadSends } from "./lead-sends";
import { checkPage, cleanSources, outsideImages, rewriteAssets, type Asset } from "./sample-page";
import { assetsForPage, cleanPages, pageName } from "./sample-pages";
import { cleanChecks, cleanRejectNote, isChecked, markOnWeb, photoBase, photoCount, photosLeft, photosRejected, rejectRequests, reviewPhotos, withChecks, withRejection, withRejectSent, type PhotoCheck, type ReviewPhoto, dishChoices, DISH_MAX, fullViewKey, photoViewKey, withDish } from "./sample-photo-checks";
import { cleanReason, openTakedown, withTakedown, withUndo } from "./sample-takedowns";
import { sha256, sha256Bytes } from "./crypto";
import { samePicture } from "./photo-same-picture";
import { guestPhotos, inlinePhotos, photoAssets, photoAssetsForPage, photoRefs, sniff, uploadProblem, type SamplePhoto } from "./sample-photos";
import { readLocal, storage } from "./storage";
import { updateSettings } from "./tenants";

async function defaultAssetStore(): Promise<AssetStore | null> {
  const st = await storage();
  return st ? { put: (k, b, t) => st.put(k, b, t) } : null;
}
import { canCloseRequest, CARD_LABEL, CARD_STATUSES, notCompleteLine, notCompleteReason, openRequestsLine, ranAgo } from "./sample-labels";
import { claims, files, leads, sampleDeletions, sampleRequests, sampleVersions, samples, tenants } from "./db/schema";

export const FAMILIES = ["eat", "shop", "services", "care", "plain"] as const;
export type Family = (typeof FAMILIES)[number];
/** The older template names, read as their family (older samples, an agent that still sends one). */
export const OLD_TEMPLATES: Record<string, Family> = { restaurant: "eat", shop: "shop", trades: "services", salon: "care", general: "plain" };
export const TEMPLATES = FAMILIES;
export type Template = Family;
/** A family id or an older template name as its family; null for anything else. */
export function familyOf(t: unknown): Family | null {
  if (typeof t !== "string") return null;
  return (FAMILIES as readonly string[]).includes(t) ? (t as Family) : (OLD_TEMPLATES[t] ?? null);
}

/** Each trade's accent (4.5:1 against white text) and its default call to action. Not our own accent colour: the page is theirs. */
const LOOK: Record<Family, { accent: string; soft: string; icon: string; noun: string }> = {
  eat: { accent: "#9f1d1d", soft: "#fdf2f2", icon: "🍽", noun: "menu" },
  shop: { accent: "#3730a3", soft: "#eef2ff", icon: "🛍", noun: "store" },
  care: { accent: "#9d174d", soft: "#fdf2f8", icon: "✂", noun: "salon" },
  services: { accent: "#115e59", soft: "#f0fdfa", icon: "🔧", noun: "service" },
  plain: { accent: "#334155", soft: "#f8fafc", icon: "★", noun: "business" },
};

/** Our own drawn illustration per trade (inline SVG, no external file): simple shapes in the accent. */
function illustration(t: Family, accent: string): string {
  const shapes: Record<Family, string> = {
    eat: `<circle cx="60" cy="60" r="34" fill="none" stroke="${accent}" stroke-width="5"/><circle cx="60" cy="60" r="20" fill="${accent}" opacity=".15"/><path d="M18 30v28M12 30v14a6 6 0 0 0 12 0V30M102 30c-8 6-8 22 0 28v32" fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round"/>`,
    shop: `<path d="M30 48h60l-6 46H36z" fill="${accent}" opacity=".15" stroke="${accent}" stroke-width="5" stroke-linejoin="round"/><path d="M46 48v-8a14 14 0 0 1 28 0v8" fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round"/>`,
    care: `<circle cx="40" cy="84" r="12" fill="none" stroke="${accent}" stroke-width="5"/><circle cx="80" cy="84" r="12" fill="none" stroke="${accent}" stroke-width="5"/><path d="M48 74 86 26M72 74 34 26" stroke="${accent}" stroke-width="5" stroke-linecap="round"/>`,
    services: `<path d="M30 90 70 50" stroke="${accent}" stroke-width="9" stroke-linecap="round"/><path d="M70 50a18 18 0 1 0 14-30l-10 10 6 8 8 6 10-10a18 18 0 0 1-28 16" fill="${accent}" opacity=".85"/>`,
    plain: `<rect x="26" y="40" width="68" height="50" rx="6" fill="${accent}" opacity=".15" stroke="${accent}" stroke-width="5"/><path d="M26 56h68M50 40V28h20v12" fill="none" stroke="${accent}" stroke-width="5"/>`,
  };
  return `<svg viewBox="0 0 120 120" width="96" height="96" aria-hidden="true">${shapes[t]}</svg>`;
}

const ICONS = {
  instagram: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.3" fill="currentColor"/></svg>`,
  facebook: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M14 8h3V4h-3a4 4 0 0 0-4 4v2H8v4h2v7h4v-7h3l1-4h-4V8z" fill="currentColor"/></svg>`,
};

// the engine's table (src/ramen/samples.py _FAMILY), the same order and words: pinned by the fixture
const PICK: [Family, RegExp][] = [
  ["eat", /restaurant|caf[eé]|coffee|bakery|pizza|deli|food|\bbar\b|grill|kitchen|taco|sushi|diner|bistro|catering|juice|\btea\b|dessert|ice cream|bbq|barbecue|brewer|winery|liquor/i],
  ["care", /salon|barber|nail|\bspa\b|beauty|hair|lash|brow|makeup|tattoo|massage|esthetic|dental|dentist|doctor|medical|clinic|health|physio|therap|chiropract|optometr|pharmac|fitness|gym|yoga|pilates|veterinar|\bvet\b|nurs|care\b/i],
  // tailoring and repair are services, before "shop" takes "Clothing store" or "Shoe repair shop"
  ["services", /tailor|alteration|sewing|seamstress|dry.?clean|laundr|cobbler|shoe repair|watch repair|phone repair|computer repair|upholster|key cut/i],
  ["shop", /clothing|boutique|shoe|apparel|fashion|store|shop|jewel|gift|market|wear|bridal|uniform|florist|furniture|wholesal|retail/i],
  ["services", /plumb|electric|contractor|cleaning|roof|hvac|heating|air.?condition|repair|auto|mechanic|construction|landscap|paint|locksmith|moving|handyman|carpent|flooring|pest|engineer|account|law|legal|attorney|insur|real estate|consult|agency|services?\b|tax|printing|photograph/i],
];

/** A listing line's first category ("4.9★ (746 reviews), Tailor, Clothing store, open 6 days" -> "Tailor"); "" when none
 *  (the engine's samples.first_category). */
export function firstCategory(kind: string | null | undefined): string {
  for (const part of String(kind ?? "").replace("Google listing:", "").split(",")) {
    const p = part.trim();
    if (p && !/★|\breviews?\b|^\(|^open\b|^closed\b|website/i.test(p)) return p;
  }
  return "";
}

/** The family for a lead's trade (the agent may name another of the five); the engine's samples.pick_template reads the
 *  same table, and both repos test it on one fixture (the Validator's tests/fixtures/sample_families.json). */
export function pickFamily(industry: string | null | undefined, kind?: string | null): Family {
  // the listing's own first category wins when it names one family ("Tailor, Clothing store" is a tailor)
  const first = firstCategory(kind);
  const hit = first ? PICK.find(([, re]) => re.test(first))?.[0] : undefined;
  if (hit) return hit;
  const text = `${industry ?? ""} ${kind ?? ""}`;
  return PICK.find(([, re]) => re.test(text))?.[0] ?? "plain";
}
export const pickTemplate = pickFamily;

/** The older copy (drafts already on Peek keep it) and copy v3, three texts: the Site Builder's current shape. */
export type CopyOld = { headline: string; intro: string; noticed?: string; sections: { title: string; body: string }[]; cta: string };
export type CopyV3 = { headline: string; about: string; cta: string };
export type Copy = CopyOld | CopyV3;
export const isV3 = (c: Copy): c is CopyV3 => "about" in c;
const LIMITS = { headline: 70, intro: 240, about: 240, noticed: 200, title: 40, body: 300, cta: 40 };
const URLISH = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|co|us|biz|info|io|shop|store|nyc|app)\b/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /\+?\d[\d ()./-]{7,}\d/;
const MONEY = /[$€£]\s?\d|\b\d+\s?(dollars|usd)\b/i;
const QUOTE = /["“”][^"“”]{12,}["“”]/;
const CLAIM = /\b(best|#\s?1|number one|no\.?\s?1|top[- ]rated|award[- ]winning|world[- ]class|cheapest|guaranteed?|leading)\b/i;

// SB05 (engine and Validator ids): a claim the row must back. The words are checked against the row's own text, numbers and years too.
const BACKED = /\b(family[- ](?:owned|run)|locally[- ]owned|owner[- ]operated|established|generations?|decades?|years? of experience|certified|licensed|insured|accredited|award)\b/gi;
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type CopyLead = {
  contactPerson?: string | null; businessEmail?: string | null; address?: string | null;
  business?: string | null; industry?: string | null; listingEvidence?: string | null; painPoint?: string | null; evidence?: string | null; notes?: string | null;
};

/** The agent's copy, trimmed and checked against the lead, or the first reason it is refused (said so the agent can fix it).
 *  `places`: the owner's own places (Settings, SB06), never on a page. */
export function checkCopy(raw: unknown, lead: CopyLead, opts: { places?: string[] } = {}): { ok: true; copy: Copy } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "copy must be {headline, about, cta}" };
  const o = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  if (typeof o.about === "string" || (o.intro === undefined && o.sections === undefined)) {
    const v3: CopyV3 = { headline: str(o.headline), about: str(o.about), cta: str(o.cta) };
    if (!v3.headline || !v3.about || !v3.cta) return { ok: false, error: "copy needs a headline, an about and a cta" };
    const bad = fieldProblem([["headline", v3.headline, LIMITS.headline], ["about", v3.about, LIMITS.about], ["cta", v3.cta, LIMITS.cta]], lead, opts.places ?? []);
    return bad ? { ok: false, error: bad } : { ok: true, copy: v3 };
  }
  const copy: CopyOld = { headline: str(o.headline), intro: str(o.intro), noticed: str(o.noticed) || undefined, cta: str(o.cta), sections: [] };
  const secs = Array.isArray(o.sections) ? o.sections : [];
  for (const s of secs) {
    const r = (s ?? {}) as Record<string, unknown>;
    copy.sections.push({ title: str(r.title), body: str(r.body) });
  }
  if (!copy.headline || !copy.intro || !copy.cta) return { ok: false, error: "copy needs a headline, an intro and a cta" };
  if (copy.sections.length < 2 || copy.sections.length > 3) return { ok: false, error: "two or three sections, each {title, body}" };
  const fields: [string, string, number][] = [["headline", copy.headline, LIMITS.headline], ["intro", copy.intro, LIMITS.intro],
    ["cta", copy.cta, LIMITS.cta], ...(copy.noticed ? [["noticed", copy.noticed, LIMITS.noticed] as [string, string, number]] : []),
    ...copy.sections.flatMap((s, i) => [[`sections[${i}].title`, s.title, LIMITS.title], [`sections[${i}].body`, s.body, LIMITS.body]] as [string, string, number][])];
  const bad = fieldProblem(fields, lead, opts.places ?? []);
  return bad ? { ok: false, error: bad } : { ok: true, copy };
}

/** The first problem in the copy's texts, or "". */
function fieldProblem(fields: [string, string, number][], lead: CopyLead, places: string[]): string {
  const rowText = [lead.business, lead.industry, lead.listingEvidence, lead.painPoint, lead.evidence, lead.notes].filter(Boolean).join(" ").toLowerCase();
  const rowNums = new Set(rowText.match(/\d+(?:\.\d+)?/g) ?? []);
  const own = places.map((p) => p.trim()).filter((p) => p.length >= 3).map((p) => new RegExp(`\\b${reEsc(p)}\\b`, "i"));
  const names = (lead.contactPerson ?? "").split(/[\s,&/]+/).filter((w) => w.length > 2 && /^[A-Z]/.test(w));
  for (const [name, text, max] of fields) {
    if (!text) return `${name} is empty`;
    if (text.length > max) return `${name} is ${text.length} characters; at most ${max}`;
    if (URLISH.test(text)) return `${name} has a web address: the page links only the map and WhatsApp itself`;
    if (EMAIL.test(text) || (lead.businessEmail && text.includes(lead.businessEmail))) return `${name} has an email address`;
    if (PHONE.test(text) && (text.match(/\d/g) ?? []).length >= 7) return `${name} has a phone number: the WhatsApp button carries it`;
    if (MONEY.test(text)) return `${name} has a price: the sample states none`;
    if (QUOTE.test(text)) return `${name} quotes something (a review?): never quote reviews`;
    if (CLAIM.test(text)) return `${name} makes a claim ("best", "#1", "top-rated"...) the listing cannot back`;
    const who = names.find((n) => new RegExp(`\\b${n.replace(/[^\w]/g, "")}\\b`, "i").test(text));
    if (who) return `${name} names a person (${who}): the page names nobody`;
    const num = (text.match(/\d+(?:\.\d+)?/g) ?? []).find((n) => !rowNums.has(n));
    if (num) return `${name} says "${num}", which the row does not: a number or a year comes only from the listing or the row (SB05)`;
    const claim = [...text.matchAll(BACKED)].map((m) => m[0]).find((m) => !rowText.includes(m.toLowerCase()));
    if (claim) return `${name} claims "${claim}", which the row does not say (SB05)`;
    if (own.some((re) => re.test(text))) return `${name} names a place the team works from: never on a sample page (SB06)`;
    if (lead.address && lead.address.length > 6 && text.toLowerCase().includes(lead.address.toLowerCase().slice(0, 12))) return `${name} has the street address: the page says only the area`;
  }
  return "";
}

/** Rating, reviews and opening days from the board's "Google listing: 3.8★ (140 reviews), Sportswear store, open 7 days". */
export function listingFacts(line: string | null | undefined): { rating?: string; reviews?: number; kind?: string; open?: string } {
  const s = (line ?? "").replace(/^google listing:\s*/i, "");
  const out: { rating?: string; reviews?: number; kind?: string; open?: string } = {};
  const r = s.match(/(\d(?:\.\d)?)\s*★\s*\((\d[\d,]*)\s+reviews?\)/i);
  if (r) {
    out.rating = r[1];
    out.reviews = Number(r[2].replace(/,/g, ""));
  }
  const open = s.match(/\bopen\s[^,(]+(?:\([^)]*\))?/i);
  if (open) out.open = open[0].replace(/^open/i, "Open").trim();
  const parts = s.replace(/\([^)]*\)/g, "").split(",").map((p) => p.trim()).filter(Boolean);
  const kind = parts.find((p) => !/★|reviews?|^open\b|no website|^no reviews/i.test(p));
  if (kind) out.kind = kind;
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safeWa = (u: string | null | undefined) => (u && /^https:\/\/wa\.me\/\d{8,15}$/.test(u.trim()) ? u.trim() : "");
const safeMap = (u: string | null | undefined) => (u && /^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(u.trim()) ? u.trim() : "");

export type SampleLead = {
  business: string; industry?: string | null; city?: string | null; state?: string | null; location?: string | null;
  whatsapp?: string | null; mapLink?: string | null; listingEvidence?: string | null;
  instagramUrl?: string | null; facebookUrl?: string | null;
  phone?: string | null; address?: string | null; painPoint?: string | null; website?: string | null;
};

export type Angle = "contact" | "menu" | "photos" | "story";
/** The page's lead section, from the pain point's first line: "found only through the listing" puts the
 *  hours and contact first, "no online menu" the menu, a photos gap the photos; anything else the story. Deterministic. */
export function angleOf(painPoint: string | null | undefined): Angle {
  const first = (painPoint ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  const t = first.replace(/^[^:]{0,40}:\s*/, "").toLowerCase();
  if (/\bmenu/.test(t)) return "menu";
  if (/photo|picture|image|gallery/.test(t)) return "photos";
  if (/listing|only (?:be )?found|hard to find|can'?t find|hours|contact|phone|whatsapp|\bcall|reach/.test(t)) return "contact";
  return "story";
}
const safeSocial = (u: string | null | undefined, host: RegExp) => {
  try {
    const x = new URL((u ?? "").trim());
    return x.protocol === "https:" && host.test(x.hostname) ? x.toString() : "";
  } catch {
    return "";
  }
};

/** The area as a map picture: one OpenStreetMap tile of the city, never the street, fetched when the
 *  draft is made and embedded, so the page makes no outside call. "" when the city is unknown or OSM does not answer. */
export async function areaMap(area: string, get: typeof fetch = fetch): Promise<string> {
  if (!area) return "";
  const ua = { "user-agent": "ProductivePeek-SampleSites/1.0 (one tile per sample, kept with it)" };
  try {
    const q = await get(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(area)}`, { headers: ua, signal: AbortSignal.timeout(6000) });
    const hit = ((await q.json()) as { lat?: string; lon?: string }[])[0];
    if (!hit?.lat || !hit?.lon) return "";
    const z = 13, lat = Number(hit.lat), lon = Number(hit.lon);
    const x = Math.floor(((lon + 180) / 360) * 2 ** z);
    const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
    const t = await get(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, { headers: ua, signal: AbortSignal.timeout(6000) });
    if (!t.ok || !(t.headers.get("content-type") ?? "").includes("image/png")) return "";
    const bytes = Buffer.from(await t.arrayBuffer());
    return bytes.length && bytes.length < 80 * 1024 ? `data:image/png;base64,${bytes.toString("base64")}` : "";
  } catch {
    return "";
  }
}
export const TAKEDOWN_TEXT = "reply to the message we sent you";

/** The area line: "Serving Astoria, NY" from the city and state columns, never the street address. With no city the state
 *  alone, else nothing: the location's first part is often the street ("31-15 Steinway St"), so it is never read here. */
export function areaOf(l: SampleLead): string {
  // an older row's city can still be its street (an older placeOf): never shown
  const raw = (l.city ?? "").trim();
  const city = looksLikeStreet(raw) ? "" : raw;
  const state = (l.state ?? "").trim();
  return city ? `${city}${state ? `, ${state}` : ""}` : state;
}

/** The footer every sample page carries (the template's, and the one the Site Builder pastes into its own page):
 *  what the page is, who made it (NEXT_PUBLIC_PEEK_SAMPLE_MAKER, the team's business name; left out when unset), the
 *  full site's price from the owner's Rates, and how to take it down. */
export function sampleFooter(business: string, price: string, maker = process.env.NEXT_PUBLIC_PEEK_SAMPLE_MAKER?.trim() ?? ""): string {
  return `<footer>A free sample ${maker ? `made by ${esc(maker)} ` : ""}for ${esc(business.split(" | ")[0].trim())}. Not the business's official site. ` +
    `The full website${maker ? ` from ${esc(maker)}` : ""}: ${price ? esc(price) : "priced after a short call"}. Ask us to take it down: ${TAKEDOWN_TEXT}.</footer>`;
}

/** The page, from the row and the copy: deterministic, escaped, inline CSS, no script, noindex. */
export function renderSample(l: SampleLead, template: Template | string, copy: Copy, extra: { mapImage?: string; price?: string } = {}): string {
  const fam = familyOf(template) ?? "plain";
  const look = LOOK[fam];
  const angle = angleOf(l.painPoint);
  const f = listingFacts(l.listingEvidence);
  const area = areaOf(l);
  const wa = safeWa(l.whatsapp);
  const map = safeMap(l.mapLink);
  const name = esc(l.business.split(" | ")[0].trim());
  const kind = esc(f.kind ?? l.industry ?? "");
  const rating = f.rating && f.reviews ? `${esc(f.rating)}★ from ${f.reviews} review${f.reviews === 1 ? "" : "s"} on Google Maps` : "";
  const facts = [
    rating ? (map ? `<li><a href="${esc(map)}" rel="nofollow noopener">${rating}</a></li>` : `<li>${rating}</li>`) : "",
    f.open ? `<li>${esc(f.open)}</li>` : "",
    // the Site Builder's rule r1: the area and the WhatsApp button, never the street or a phone
    area ? `<li>Serving ${esc(area)}</li>` : "",
    map && !rating ? `<li><a href="${esc(map)}" rel="nofollow noopener">Find us on Google Maps</a></li>` : "",
  ].filter(Boolean).join("");
  const sections = isV3(copy) ? "" : copy.sections.map((s) => `<section><h2>${esc(s.title)}</h2><p>${esc(s.body)}</p></section>`).join("");
  const cta = wa ? `<a class="cta" href="${esc(wa)}" rel="nofollow noopener">${esc(copy.cta)}</a>` : "";
  const ig = safeSocial(l.instagramUrl, /^(www\.)?instagram\.com$/);
  const fb = safeSocial(l.facebookUrl, /^(www\.|m\.)?facebook\.com$/);
  const social = ig || fb ? `<p class="social">${ig ? `<a href="${esc(ig)}" rel="nofollow noopener" aria-label="Instagram">${ICONS.instagram}</a>` : ""}${fb ? `<a href="${esc(fb)}" rel="nofollow noopener" aria-label="Facebook">${ICONS.facebook}</a>` : ""}</p>` : "";
  const mapBtn = map ? `<a class="btn2" href="${esc(map)}" rel="nofollow noopener">Open in Google Maps</a>` : "";
  const mapImg = extra.mapImage && extra.mapImage.startsWith("data:image/png;base64,")
    ? `<figure class="area"><img src="${extra.mapImage}" alt="Map of ${esc(area)}" width="256" height="256"><figcaption>© OpenStreetMap contributors</figcaption></figure>` : "";
  const photos = `<div class="photos" aria-label="Photos">Your photos go here</div>`;
  const about = `<h2 style="margin-top:0">${esc(copy.headline)}</h2><p class="lead">${esc(isV3(copy) ? copy.about : copy.intro)}</p>` +
    `${!isV3(copy) && copy.noticed ? `<p class="noticed">${esc(copy.noticed)}</p>` : ""}${sections}`;
  const contact = `${facts ? `<ul class="facts">${facts}</ul>` : ""}${cta}${mapBtn}${social}`;
  const menu = fam === "eat" || angle === "menu" ? `<section class="menu"><h2>Menu</h2><p>Your dishes go here, each with its photo.</p></section>` : "";
  const order: Record<Angle, string[]> = {
    contact: [contact, about, menu, photos],
    menu: [about, menu, contact, photos],
    photos: [about, photos, contact, menu],
    story: [about, contact, menu, photos],
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow"><title>${name}${area ? ` · ${esc(area)}` : ""}</title><style>` +
    `*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;background:${look.soft}}` +
    `header{background:${look.accent};color:#fff;padding:2.5rem 1.25rem 2rem}header .i{font-size:2rem}header h1{margin:.25rem 0;font-size:1.9rem;line-height:1.2}` +
    `header p{margin:0;opacity:.92}main{max-width:44rem;margin:0 auto;padding:1.5rem 1.25rem}.lead{font-size:1.1rem}` +
    `.noticed{border-left:4px solid ${look.accent};padding:.25rem .75rem;color:#374151;background:#fff}` +
    `section{background:#fff;border-radius:.75rem;padding:1rem 1.25rem;margin:1rem 0;box-shadow:0 1px 2px rgba(0,0,0,.06)}section h2{margin:0 0 .35rem;font-size:1.15rem;color:${look.accent}}` +
    `section p{margin:0}ul.facts{list-style:none;padding:0;margin:1rem 0;display:flex;flex-wrap:wrap;gap:.5rem}ul.facts li{background:#fff;border-radius:999px;padding:.35rem .8rem;font-size:.92rem}` +
    `a{color:${look.accent}}.cta{display:inline-block;margin:1rem 0;background:${look.accent};color:#fff;text-decoration:none;padding:.8rem 1.4rem;border-radius:.6rem;font-weight:600}` +
    `.btn2{display:inline-block;margin:0 0 0 .5rem;padding:.75rem 1.1rem;border:2px solid ${look.accent};border-radius:.6rem;text-decoration:none;font-weight:600}` +
    `.social{display:flex;gap:.75rem;margin:.5rem 0}.social a{color:${look.accent}}header .art{float:right;opacity:.95}header .art svg{background:#fff;border-radius:1rem;padding:.4rem}` +
    `.photos{margin:1rem 0;border:2px dashed ${look.accent};border-radius:.75rem;padding:2.5rem 1rem;text-align:center;color:${look.accent};background:#fff;opacity:.8}` +
    `figure.area{margin:1rem 0;background:#fff;border-radius:.75rem;padding:.5rem;text-align:center}figure.area img{max-width:100%;height:auto;border-radius:.5rem}figure.area figcaption{font-size:.75rem;color:#6b7280}` +
    `footer{max-width:44rem;margin:2rem auto 0;padding:1rem 1.25rem 2rem;font-size:.8rem;color:#6b7280;border-top:1px solid #e5e7eb}</style></head><body>` +
    `<header><div class="art">${illustration(fam, look.accent)}</div><div class="i" aria-hidden="true">${look.icon}</div><h1>${name}</h1><p>${kind}${kind && area ? " · " : ""}${area ? esc(area) : ""}</p></header>` +
    `<main data-angle="${angle}" data-area="${esc(area)}">${order[angle].join("")}${mapImg}</main>` +
    `${sampleFooter(l.business, extra.price ?? "")}</body></html>`;
}

/** "taco-loco-astoria-k3f9": the name and area plus four random characters, so an address cannot be guessed from a name. */
export function sampleSlug(business: string, area: string, rand = randomBytes(2).toString("hex")): string {
  const base = `${business.split(" | ")[0]} ${area.split(",")[0]}`.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return `${base || "sample"}-${rand}`;
}

/** The full site's price as the owner's Rates state it (the "Starter Website: ..." line on the Asset page), or "" (none:
 *  the footer says it is priced after a short call; a price never comes from anywhere else). */
export async function starterPrice(d: Db, tenantId: string): Promise<string> {
  const line = (await listRates(d, tenantId)).find((r) => /^starter website\b/i.test(r.offer));
  // the first clause only: "$990 one-time for a one-page site built from your listing; a free
  // sample first; ..." -> "$990 one-time for a one-page site built from your listing"; past 80 characters cut at a word
  const first = (line?.price ?? "").replace(/\s+/g, " ").trim().split(/\s*;\s*/).filter(Boolean)[0] ?? "";
  if (first.length <= 80) return first;
  return first.slice(0, 81).replace(/\s+\S*$/, "").replace(/[,.:\s]+$/, "");
}

// ---- hashes and facts -----------------------------------------------------------------------------------------
type Row = typeof leads.$inferSelect;
const hash = (parts: unknown[]) => createHash("sha1").update(JSON.stringify(parts.map((v) => String(v ?? "").replace(/\s+/g, " ").trim()))).digest("hex").slice(0, 16);
/** What the page shows from the row, besides the copy: a change re-renders the page with the same copy (no model call).
 *  The street address and the phone are not on the page (rule r1), so they are not in it. */
export const factsHash = (l: Partial<Row>) =>
  hash([l.whatsapp, l.website, l.instagramUrl, l.facebookUrl, l.mapLink, l.listingEvidence, l.location, l.city, l.state, l.industry, l.business]);
/** What the copy was written from: a change lists the lead as "recopy" for the Site Builder. */
export const copyHash = (l: Partial<Row>) => hash([(l.business ?? "").split(" | ")[0], l.painPoint, listingFacts(l.listingEvidence).kind, l.industry]);
/** The cells whose change can re-render a sample (the lead write hook reads `written` against these). */
export const FACT_KEYS = ["whatsapp", "website", "instagram_url", "facebook_url", "map_link", "listing_evidence", "location", "industry", "business"];
export const FROZEN_RESULTS = ["Replied", "Meeting"];

export type QueueFacts = {
  business: string; trade: string; address: string; phone: string; whatsapp: string; website: string; instagram: string; facebook: string;
  mapLink: string; painPoint: string; listing: string; rating: string; reviews: number | null; kind: string; open: string;
  /** the Enricher's site facts, as written; null before the Enricher has been */
  siteFacts: Record<string, unknown> | null;
  /** the exact footer to paste before </body> in a page the Site Builder writes */
  footer?: string;
};
/** The row's facts as the queue gives them to the Site Builder (the same cells the page is rendered from). */
export function factsOf(l: Row): QueueFacts {
  const f = listingFacts(l.listingEvidence);
  return {
    business: l.business.split(" | ")[0].trim(), trade: l.industry ?? "", address: l.address ?? "", phone: l.phone ?? "", whatsapp: l.whatsapp ?? "",
    website: l.website ?? "", instagram: l.instagramUrl ?? "", facebook: l.facebookUrl ?? "", mapLink: l.mapLink ?? "", painPoint: l.painPoint ?? "",
    listing: l.listingEvidence ?? "", rating: f.rating ?? "", reviews: f.reviews ?? null, kind: f.kind ?? "", open: f.open ?? "",
    siteFacts: l.siteFacts ?? null,
  };
}
/** A builder page's facts hash: the row's facts and the Enricher's site facts. A change lists the lead as
 *  "recopy" (the Site Builder rewrites its page; Peek never re-renders one). */
export const pageFactsHash = (l: Partial<Row>) => `${factsHash(l)}:${hash([JSON.stringify(l.siteFacts ?? null)])}`;

// ---- the database ------------------------------------------------------------------------------------------------------
export const OPEN = ["draft", "changes_requested"] as const;
export type SampleRow = Omit<typeof samples.$inferSelect, "html" | "pages"> & { pageNames?: string[]; galleryPhotos?: number; usedPhotos?: string[]; firstDraftedBy?: string }; // the list leaves the pages out, as the html: their names only
// the photos a gallery page points at (photos/<name> or ../photos/<name>), as photoRefs reads them
const GALLERY_REF = "(?:\\.\\./)?photos/([a-z0-9][a-z0-9._-]{0,63}\\.(?:webp|jpe?g|png))";
const listCols = { id: samples.id, tenantId: samples.tenantId, leadId: samples.leadId, slug: samples.slug, template: samples.template, copy: samples.copy,
  status: samples.status, version: samples.version, note: samples.note, draftedBy: samples.draftedBy, reviewedBy: samples.reviewedBy,
  reviewedAt: samples.reviewedAt, url: samples.url, publishedAt: samples.publishedAt, factsHash: samples.factsHash, copyHash: samples.copyHash,
  hold: samples.hold, frozenAt: samples.frozenAt, changesNote: samples.changesNote, createdAt: samples.createdAt, updatedAt: samples.updatedAt,
  kind: samples.kind, changes: samples.changes, sources: samples.sources, signature: samples.signature, assets: samples.assets, photos: samples.photos, designReason: samples.designReason,
  approvedVersion: samples.approvedVersion,
  notComplete: samples.notComplete,
  // who drafted the site first: the earliest kept version's maker, else (one version so far) the drafter now. draftedBy
  // stays the latest version's drafter, the one a request goes to; a site reworked by someone else keeps its first author
  // (table names written out: a select from samples alone renders its columns without them, which the subquery would misread)
  firstDraftedBy: sql<string>`coalesce((select v.made_by from sample_versions v where v.sample_id = "samples"."id" and v.made_by <> '' order by v.version asc limit 1), "samples"."drafted_by")`,
  // the extra pages' names ("gallery"), for the card's switcher
  pageNames: sql<string[]>`coalesce((select array_agg(split_part(p->>'path', '/', 1)) from jsonb_array_elements(${samples.pages}) p), '{}')`,
  // the target is more than 20 photos on each gallery: the sample's uploaded photos its gallery page uses,
  // counted here so the list never carries the pages' html
  galleryPhotos: sql<number>`(select count(distinct m[1])::int from jsonb_array_elements(${samples.pages}) p, regexp_matches(p->>'html', ${GALLERY_REF}, 'g') m
    where split_part(p->>'path', '/', 1) = 'gallery' and m[1] in (select ph->>'name' from jsonb_array_elements(${samples.photos}) ph))`,
  // the uploaded photos its pages use, read here so the list still never carries the pages' html
  usedPhotos: sql<string[]>`(select coalesce(array_agg(distinct m[1]), '{}') from regexp_matches(${samples.html} || ' ' || ${samples.pages}::text, ${GALLERY_REF}, 'g') m)` };

const strip = (r: typeof samples.$inferSelect): SampleRow => {
  const { html: _html, pages, ...rest } = r;
  void _html;
  return { ...rest, pageNames: (pages ?? []).map((p) => p.path.split("/")[0]) };
};

export class SampleError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** The owner's sample settings: auto-approve and the places never named (SB06). */
export async function sampleSettings(d: Db, tenantId: string): Promise<{ autoPublish: boolean; places: string[] }> {
  const [t] = await d.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  return { autoPublish: !!t?.s?.samplesAutoPublish, places: Array.isArray(t?.s?.ownPlaces) ? t.s.ownPlaces.filter((p) => typeof p === "string") : [] };
}

/** The version a re-render or a new draft replaces, kept in sample_versions. */
async function keepVersion(d: Db, s: typeof samples.$inferSelect, by: string) {
  await d.insert(sampleVersions).values({ tenantId: s.tenantId, sampleId: s.id, version: s.version, template: s.template, copy: s.copy, html: s.html,
    factsHash: s.factsHash, status: s.status, notComplete: s.notComplete, madeBy: by || s.draftedBy, madeAt: s.updatedAt, kind: s.kind, changes: s.changes, sources: s.sources, signature: s.signature, designReason: s.designReason, pages: s.pages, assets: s.assets ?? [] });
}

const AUTO = "Auto-approved (Settings)";
/** The one plain line a builder meets. */
export const HUMAN_REQUEST_ONLY = "this sample is approved or live: by the owner's rule it gets a new version only for a signed-in person's open change request, named in answers";
/** why a draft that uses a guest's photo was not auto-approved. */
const GUEST_WAITS = "a photo is on the page: a person checks it and approves";

/** The agent's draft for a lead: rendered and stored. A draft waiting for a person is never replaced (409) unless the row's
 *  name, pain point or listing kind changed since its copy ("recopy"); a draft a person sent back ("changes_requested") is,
 *  as the next version; so is a frozen approved or live sample with a person's note (it stays approved or live: the person
 *  asked for that change) and an unfrozen one whose copy is out of date (back to draft for a person, unless auto-approve
 *  is on). Otherwise an approved, live or taken-down sample ends the turn. `template` is a family or an older name. */
export type PageDraft = { html: unknown; changes?: unknown; sources?: unknown; signature?: unknown; designReason?: unknown; pages?: unknown;
  /** the change requests this version answers -- a list: exactly those; missing or []: none */
  answers?: unknown;
  /** why this version arrived incomplete. It closes no request and cannot be approved; a later version clears it. */
  notComplete?: unknown };
const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
/** The Site Builder's style signature, kept as sent when it is a small object. */
const cleanSignature = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) && JSON.stringify(v).length <= 4000 ? (v as Record<string, unknown>) : null);

export async function saveDraft(d: Db, tenantId: string, leadId: string, template: unknown, rawCopy: unknown, by: string,
                                getMap: (area: string) => Promise<string> = (a) => areaMap(a), page?: PageDraft): Promise<SampleRow & { waits?: string; answered: string[] }> {
  const [lead] = await d.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
  if (!lead) throw new SampleError(404, "no such lead");
  // the sample's uploaded photos (kept across drafts) are what a page may point at as photos/<name>
  const [prior] = await d.select({ photos: samples.photos }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.leadId, leadId))).orderBy(desc(samples.version)).limit(1);
  const photoNames = (prior?.photos ?? []).map((p) => p.name);
  const t: Family = familyOf(template) ?? pickFamily(lead.industry, listingFacts(lead.listingEvidence).kind);
  const conf = await sampleSettings(d, tenantId);
  // the Site Builder's own page: checked and kept as it is; its copy is optional (kept when it passes)
  const own = page ? (() => {
    const sources = cleanSources(page.sources);
    const r = checkPage(page.html, lead, sources, { names: photoNames });
    if (!r.ok) throw new SampleError(400, r.error);
    for (const place of conf.places) if (place && r.html.toLowerCase().includes(place.toLowerCase())) throw new SampleError(400, `the page names ${place}, a place the owner keeps off sample pages`);
    // its extra pages (a gallery), each checked like the main page, the owner's places too
    const extra = cleanPages(page.pages, lead, sources, photoNames);
    if (!extra.ok) throw new SampleError(400, extra.error);
    for (const pg of extra.pages) for (const place of conf.places) if (place && pg.html.toLowerCase().includes(place.toLowerCase())) throw new SampleError(400, `${pageName(pg.path)} names ${place}, a place the owner keeps off sample pages`);
    return { pages: extra.pages, html: r.html, sources, changes: line(page.changes, 500), designReason: typeof page.designReason === "string" ? page.designReason.trim().slice(0, 1500) : "", signature: cleanSignature(page.signature), notComplete: notCompleteReason(page.notComplete) };
  })() : null;
  const c = own ? (rawCopy ? checkCopy(rawCopy, lead, { places: conf.places }) : null) : checkCopy(rawCopy, lead, { places: conf.places });
  if (c && !c.ok && !own) throw new SampleError(400, c.error);
  const copy = (c && c.ok ? c.copy : {}) as Copy;
  const [found] = await d.select().from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.leadId, leadId))).orderBy(desc(samples.version)).limit(1);
  // a shell (photos uploaded before any page) is no sample yet -- its first page is checked as a first one and
  // fills the shell's row as version 1, keeping its photos
  const shell = found?.status === SHELL ? found : null;
  const last = shell ? undefined : found;
  const stale = !!last && !last.frozenAt && (last.kind === "page" ? !!last.factsHash && last.factsHash !== pageFactsHash(lead) : !!last.copyHash && last.copyHash !== copyHash(lead));
  // a person's open change request (or the older changes note) lets an approved or live sample take a new version
  const openAsks = last ? await openRequestCount(d, tenantId, last.id) : 0;
  const noted = !!last && (!!last.changesNote || openAsks > 0) && ["approved", "live"].includes(last.status);
  // a waiting draft is replaced only when its copy is out of date, or by the Site Builder's own better page
  if (last && last.status === "draft" && !stale && !own) throw new SampleError(409, "a draft for this lead is waiting for a person's review");
  // a site that is approved and live is not updated until a person asks for it: a
  // sample that is on the web, or has an approved version, takes a new version only for a signed-in person's open request, which
  // the version names in `answers`. It then waits as a draft beside the approved version, which stays up. Also refused: a
  // frozen sample (the lead answered) without a person's request, and a sample taken down or rejected.
  const upNow = !!last && ["approved", "live"].includes(last.status);
  if (last && upNow && last.frozenAt && !noted) throw new SampleError(409, "this lead answered (the sample is frozen): a person's change request opens a new version");
  if (last && !["draft", "changes_requested"].includes(last.status) && !upNow)
    throw new SampleError(409, `this lead's sample is ${last.status.replace("_", " ")}: a person decides what comes next`);
  // an incomplete version names nothing, so a person's open request is enough for it: it closes none and cannot be approved
  const onWeb = !!last && (upNow || last.approvedVersion !== null);
  if (last && onWeb) {
    const persons = await d.select({ id: sampleRequests.id }).from(sampleRequests).where(and(eq(sampleRequests.tenantId, tenantId), eq(sampleRequests.sampleId, last.id), eq(sampleRequests.status, "open"), isNotNull(sampleRequests.byUser)));
    const named = Array.isArray(page?.answers) ? (page.answers as unknown[]) : [];
    if (!persons.some((r) => named.includes(r.id)) && !(own?.notComplete && persons.length)) throw new SampleError(409, HUMAN_REQUEST_ONLY);
  }
  if ((lead.website ?? "").trim()) throw new SampleError(409, "this business has a website: a sample is only for one without");
  if (!last && (await deletedOpen(d, tenantId, leadId))) throw new SampleError(409, "the owner deleted this lead's sample: reopen it first (POST /v1/samples/reopen)");
  const html = own ? own.html : renderSample(lead, t, copy, { mapImage: await getMap(areaOf(lead)), price: await starterPrice(d, tenantId) });
  // a template page's own text and CSS stay under 30 KB; the embedded area map (one OSM tile, < 80 KB) comes on top
  if (!own && Buffer.byteLength(html.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, "")) > 30 * 1024) throw new SampleError(400, "the page is over 30 KB: shorten the copy");
  const now = new Date();
  // a page that shows any photo waits for a person's checks and approval, whatever autoPublish says
  const ownDoc = own ? [own.html, ...own.pages.map((x) => x.html)].join("\n") : "";
  const guestUsed = !!own && (photoRefs(ownDoc).length > 0 || outsideImages(ownDoc).length > 0);
  // Settings' auto-approve never reaches a sample that is on the web: a person approves its new version
  const auto = conf.autoPublish && !(last?.hold ?? false) && !guestUsed && !onWeb;
  const waits = conf.autoPublish && guestUsed ? { waits: GUEST_WAITS } : {};
  const hashes = { factsHash: own ? pageFactsHash(lead) : factsHash(lead), copyHash: copyHash(lead) };
  const notComplete = own?.notComplete ?? "";
  const made = own
    ? { kind: "page", changes: own.changes, sources: own.sources, signature: own.signature, designReason: own.designReason, assets: [], pages: own.pages, notComplete }
    : { kind: "template", changes: "", sources: [], signature: null, designReason: "", assets: [], pages: [], notComplete };
  if (last) {
    await keepVersion(d, last, "");
    // a new version is a draft (or auto-approved by Settings): never live without a person's or Settings' yes,
    // and the version approved before it stays on the web (approvedVersion) until this one is approved. A version
    // that leaves a request open stays with the builder: it does not wait for a person, and Settings does not approve it
    const version = last.version + 1;
    const asked = await d.select({ id: sampleRequests.id }).from(sampleRequests)
      .where(and(eq(sampleRequests.tenantId, tenantId), eq(sampleRequests.sampleId, last.id), eq(sampleRequests.status, "open")));
    // an incomplete version closes nothing, whatever its list says, and stays with the builder with its reason as the note
    const answers = notComplete ? [] : page?.answers;
    const leaves = asked.length - answeredBy(asked, answers).length;
    const status = notComplete || leaves ? "changes_requested" : auto ? "approved" : "draft";
    const noteNow = notComplete ? { note: notComplete } : last.notComplete && last.note === last.notComplete ? { note: "" } : {};
    const [row0] = await d.update(samples).set({ template: t, copy, html, status, version, draftedBy: by, updatedAt: now, ...hashes, ...made, ...noteNow,
      changesNote: "", ...(status === "approved" ? { reviewedBy: AUTO, reviewedAt: now, approvedVersion: version } : {}) })
      .where(eq(samples.id, last.id)).returning();
    const answered = await answerRequests(d, tenantId, last.id, version, answers, now);
    // a request filed while this version was being saved is open too
    const late = status === "draft" ? await openRequestCount(d, tenantId, last.id) : 0;
    const [sentBack] = late ? await d.update(samples).set({ status: "changes_requested" }).where(and(eq(samples.id, last.id), eq(samples.version, version), eq(samples.status, "draft"))).returning() : [];
    const row = await mirrorNote(d, tenantId, sentBack ?? row0);
    return { ...strip(row), ...waits, answered };
  }
  const first = { tenantId, leadId, slug: sampleSlug(lead.business, areaOf(lead)), template: t, copy, html, draftedBy: by,
    ...hashes, ...made, frozenAt: shell?.frozenAt ?? (FROZEN_RESULTS.includes(lead.result ?? "") ? now : null), ...(notComplete ? { status: "changes_requested", note: notComplete } : auto ? { status: "approved", reviewedBy: AUTO, reviewedAt: now, approvedVersion: 1 } : {}) };
  const [row] = shell
    ? await d.update(samples).set({ status: "draft", ...first, version: 1, createdAt: now, updatedAt: now }).where(eq(samples.id, shell.id)).returning()
    : await d.insert(samples).values(first).returning();
  return { ...strip(row), ...waits, answered: [] };
}

/** A facts change on the lead: the current page re-rendered with its own copy, version + 1, the old one kept. Not for a
 *  frozen or taken-down sample, nor once the business has a website (the publisher withdraws it). The area map is reused
 *  while the area is the same. Answers the new version, or null when nothing was done. */
export async function rerenderFacts(d: Db, tenantId: string, leadId: string, getMap: (area: string) => Promise<string> = (a) => areaMap(a)): Promise<SampleRow | null> {
  const [lead] = await d.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
  const [s] = lead ? await d.select().from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.leadId, leadId))).orderBy(desc(samples.version)).limit(1) : [];
  // a page the Site Builder wrote is never re-rendered from a template: the queue lists it as "recopy"
  if (!lead || !s || s.kind === "page" || ["taken_down", "rejected", SHELL].includes(s.status) || s.frozenAt || (lead.website ?? "").trim()) return null;
  // a sample on the web is not updated without a person's request, so a facts change does not re-render it
  if (["approved", "live"].includes(s.status) || s.approvedVersion !== null) return null;
  const fh = factsHash(lead);
  if (s.factsHash === fh) return null;
  const area = areaOf(lead);
  const oldArea = s.html.match(/data-area="([^"]*)"/)?.[1];
  const oldMap = s.html.match(/data:image\/png;base64,[A-Za-z0-9+/=]+/)?.[0] ?? "";
  const mapImage = oldArea !== undefined && oldArea === esc(area) ? oldMap : await getMap(area);
  const fam = familyOf(s.template) ?? pickFamily(lead.industry, listingFacts(lead.listingEvidence).kind);
  const html = renderSample(lead, fam, s.copy as unknown as Copy, { mapImage, price: await starterPrice(d, tenantId) });
  await keepVersion(d, s, "");
  // on an approved or live sample the re-render waits for a person (or Settings' auto-approve) like any new
  // version; the approved one stays on the web meanwhile (approvedVersion)
  const conf = await sampleSettings(d, tenantId);
  const up = ["approved", "live"].includes(s.status);
  // a re-render answers no request, so with one open it stays with the builder
  const asks = up ? await openRequestCount(d, tenantId, s.id) : 0;
  const auto = up && !asks && conf.autoPublish && !s.hold;
  const now = new Date();
  const status = !up ? s.status : asks ? "changes_requested" : auto ? "approved" : "draft";
  const [row] = await d.update(samples).set({ html, template: fam, version: s.version + 1, factsHash: fh, updatedAt: now, status,
    ...(auto ? { reviewedBy: AUTO, reviewedAt: now, approvedVersion: s.version + 1 } : {}) }).where(eq(samples.id, s.id)).returning();
  return strip(row);
}

/** The lead's answer (Replied or Meeting) freezes its sample: no automatic rebuild after it. */
export async function freezeSample(d: Db, tenantId: string, leadId: string, now = new Date()) {
  await d.update(samples).set({ frozenAt: now }).where(and(eq(samples.tenantId, tenantId), eq(samples.leadId, leadId), isNull(samples.frozenAt), ne(samples.status, "taken_down")));
}

/** After a lead write commits (lib/leads.ts writeLead): freeze at Replied or Meeting; re-render on a facts change (not for an
 *  import: the queue's sweep catches those). Never fails the write: a problem is logged. */
export async function onLeadWrite(d: Db, tenantId: string, leadId: string, written: string[], result: string | null, opts: { import?: boolean } = {}) {
  try {
    if (written.includes("result") && FROZEN_RESULTS.includes(result ?? "")) await freezeSample(d, tenantId, leadId);
    if (!opts.import && written.some((k) => FACT_KEYS.includes(k))) {
      const [has] = await d.select({ id: samples.id }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.leadId, leadId))).limit(1);
      if (has) await rerenderFacts(d, tenantId, leadId);
    }
  } catch (err) {
    console.error("samples.onLeadWrite", err instanceof Error ? err.message : err);
  }
}

/** Samples without their html, newest first: by status and/or lead (the agent's list, the Validator's checks). */
/** The most rows one list answers (/v1/samples says so in its log when it reaches this). */
export const SAMPLE_LIST_LIMIT = 200;
export async function listSamples(d: Db, tenantId: string, opts: { status?: string[]; leadId?: string; id?: string } = {}): Promise<SampleRow[]> {
  const where = [eq(samples.tenantId, tenantId)];
  if (opts.id) where.push(eq(samples.id, opts.id));
  if (opts.status?.length) where.push(inArray(samples.status, opts.status));
  if (!opts.status?.includes(SHELL)) where.push(ne(samples.status, SHELL)); // a shell only when asked for by name
  if (opts.leadId) where.push(eq(samples.leadId, opts.leadId));
  return d.select(listCols).from(samples).where(and(...where)).orderBy(desc(samples.updatedAt)).limit(SAMPLE_LIST_LIMIT);
}

// ---- the Samples page (the drafts were reachable only through each lead's row, and hard to find) -----
export { CARD_LABEL, CARD_STATUSES };
export type SampleCard = {
  id: string; leadId: string; business: string; area: string; trade: string; template: string; status: string; version: number;
  draftedAt: string; draftedBy: string; /** who drafted the site first (draftedBy is the latest version's drafter); absent means draftedBy */ firstDraftedBy?: string; reviewedBy: string; url: string; hold: boolean; frozen: boolean; note: string; leadHref: string;
  /** the Site Builder's own page ("page") or a template one; what this version changed; why it looks as it does;
   *  where its facts came from */
  kind: string; changes: string; designReason: string; sources: { fact: string; from: string }[];
  /** where "Open site" goes: the live address for a live page, else the signed-in preview of exactly the stored html */
  open: string;
  /** its extra pages, each opening where "Open site" does (the live address's folder, or the preview's ?page=) */
  pages: { name: string; open: string }[];
  /** its photos that are a guest's (not the business's own), so the person approving can ask the business to
   *  swap them before a site goes live */
  guestPhotos: { name: string; dish: string }[];
  /** Every uploaded photo the page uses, one row per photo, with what a person checked. */
  photoChecks?: ReviewPhoto[];
  /** The lead's own items a photo can be marked with. */
  dishChoices?: string[];
  /** The uploaded photos the gallery page uses (null for a template sample). */
  galleryPhotos?: number | null;
  /** The business's Website cell is filled (the sample comes down), and an auto-approved page with a guest's
   *  photo (it waits for a person's Approve). */
  website?: boolean;
  guestWait?: boolean;
  /** the version on the web (or to go up) while a newer one waits; null until one is approved */
  approvedVersion: number | null;
  /** its change requests, newest first (at most 20), each with its pictures' numbers */
  requests: CardRequest[];
  /** Why this version arrived incomplete ("" or absent when it did not). */
  notComplete?: string;
};
export type CardRequest = { id: string; text: string; by: string; byUser?: string | null; at: string; madeOn: number; status: string; answeredVersion: number | null; pictures: number[] };

/** Pure: one card from a sample and its lead -- the name before " | ", the area as city and state only (never the street
 *  or a phone: the city and state columns only, never the location's first part, which can be the street), the trade. A live page opens at its address (https only), every other one at /samples/<id>/preview. */
export function cardOf(s: Pick<SampleRow, "id" | "leadId" | "template" | "status" | "version" | "updatedAt" | "draftedBy" | "reviewedBy" | "url" | "hold" | "frozenAt" | "note" | "changesNote">
  & Partial<Pick<SampleRow, "kind" | "changes" | "designReason" | "sources" | "pageNames" | "photos" | "approvedVersion" | "galleryPhotos" | "usedPhotos" | "notComplete" | "firstDraftedBy">>,
  l: SampleLead & { dishFacts?: unknown }, requests: CardRequest[] = []): SampleCard {
  const live = s.status === "live" && /^https:\/\/[^\s"'<>]+$/.test(s.url);
  return {
    id: s.id, leadId: s.leadId, business: l.business.split(" | ")[0].trim(), area: [l.city?.trim(), l.state?.trim()].filter(Boolean).join(", "), trade: (l.industry ?? "").trim() || listingFacts(l.listingEvidence).kind || "",
    template: familyOf(s.template) ?? s.template, status: s.status, version: s.version, draftedAt: s.updatedAt.toISOString(), draftedBy: s.draftedBy, firstDraftedBy: s.firstDraftedBy || s.draftedBy,
    reviewedBy: s.reviewedBy, url: s.url, hold: s.hold, frozen: !!s.frozenAt, note: s.changesNote || (["changes_requested", "rejected"].includes(s.status) ? s.note : ""),
    kind: s.kind ?? "template", changes: s.changes ?? "", designReason: s.designReason ?? "",
    sources: ((s.sources ?? []) as { fact: string; from: string }[]).filter((x) => /^https?:\/\//.test(x.from)).slice(0, 40),
    open: live ? s.url : `/samples/${s.id}/preview`, leadHref: leadPath(s.leadId),
    pages: (s.pageNames ?? []).map((name) => ({ name, open: live ? `${s.url.replace(/\/?$/, "/")}${name}/` : `/samples/${s.id}/preview?page=${encodeURIComponent(name)}` })),
    guestPhotos: guestPhotos((s.photos ?? []) as SamplePhoto[]).map((p) => ({ name: p.name, dish: p.dish })),
    photoChecks: reviewPhotos((s.photos ?? []) as SamplePhoto[], s.usedPhotos ?? []),
    dishChoices: dishChoices(l.dishFacts),
    approvedVersion: s.approvedVersion ?? null, requests, notComplete: s.notComplete ?? "",
    // only on the Site Builder's own pages (a template has no gallery); a target, never a block
    galleryPhotos: (s.kind ?? "template") === "page" ? Number(s.galleryPhotos ?? 0) : null,
    website: !!(l.website ?? "").trim(),
    guestWait: s.reviewedBy === AUTO && (s.usedPhotos ?? []).length > 0,
  };
}

/** The most cards the Samples page lists; past it the page says how many it left out. */
export const CARD_LIMIT = 500;
/** Every sample as a card, newest first (by its last change), optionally one status; with the count of each status. */
export async function sampleCards(d: Db, tenantId: string, status?: string, limit = CARD_LIMIT): Promise<{ cards: SampleCard[]; counts: Record<string, number>; total: number }> {
  const every = and(eq(samples.tenantId, tenantId), ne(samples.status, SHELL));
  const picking = d.select({ s: listCols, business: leads.business, industry: leads.industry, city: leads.city, state: leads.state, location: leads.location, listingEvidence: leads.listingEvidence, website: leads.website,
    // only the three lists a photo's mark can come from, not the whole facts
    dishFacts: sql<unknown>`jsonb_build_object('offers', ${leads.siteFacts}->'offers', 'popular', ${leads.siteFacts}->'popular', 'menu', ${leads.siteFacts}->'menu')` })
    .from(samples).innerJoin(leads, eq(leads.id, samples.leadId)).where(status ? and(every, eq(samples.status, status)) : every)
    // past the limit, finished samples are the ones left out, never one still waiting on someone
    .orderBy(sql`case when ${samples.status} in ('taken_down', 'rejected') then 1 else 0 end`, desc(samples.updatedAt)).limit(limit);
  // (the select carries the lead's website)
  // the counts come from every sample, not from the rows the limit kept
  const [picked, byStatus] = await Promise.all([
    picking,
    d.select({ status: samples.status, n: sql<number>`count(*)::int` }).from(samples).innerJoin(leads, eq(leads.id, samples.leadId)).where(every).groupBy(samples.status),
  ]);
  const shown = [...picked].sort((a, b) => b.s.updatedAt.getTime() - a.s.updatedAt.getTime());
  const counts: Record<string, number> = Object.fromEntries(CARD_STATUSES.map((k) => [k, 0]));
  for (const r of byStatus) counts[r.status] = Number(r.n);
  const total = status ? (counts[status] ?? 0) : Object.values(counts).reduce((n, c) => n + c, 0);
  const older = shown.filter((r) => r.s.url && r.s.approvedVersion !== null && r.s.approvedVersion !== r.s.version);
  // each card's change requests, newest first
  // which photos the version on the web shows, so a Reject can say the page stays up until a version without it
  const [asks, olderRefs] = await Promise.all([
    shown.length
      ? d.select().from(sampleRequests).where(and(eq(sampleRequests.tenantId, tenantId), inArray(sampleRequests.sampleId, shown.map((r) => r.s.id)))).orderBy(desc(sampleRequests.at))
      : [],
    older.length
      ? d.select({ id: sampleVersions.sampleId, names: sql<string[]>`(select coalesce(array_agg(distinct m[1]), '{}') from regexp_matches(${sampleVersions.html} || ' ' || coalesce(${sampleVersions.pages}::text, ''), ${GALLERY_REF}, 'g') m)` })
        .from(sampleVersions).where(and(eq(sampleVersions.tenantId, tenantId), or(...older.map((r) => and(eq(sampleVersions.sampleId, r.s.id), eq(sampleVersions.version, r.s.approvedVersion as number))))))
      : [],
  ]);
  const bySample = new Map<string, CardRequest[]>();
  for (const q of asks) {
    const list = bySample.get(q.sampleId) ?? [];
    if (list.length < 20) list.push({ id: q.id, text: q.text, by: q.byName, byUser: q.byUser, at: q.at.toISOString(), madeOn: q.madeOnVersion, status: q.status, answeredVersion: q.answeredVersion, pictures: (q.pictures ?? []).map((p) => p.n) });
    bySample.set(q.sampleId, list);
  }
  const webNames = new Map(olderRefs.map((v) => [v.id, v.names ?? []]));
  const cards = shown.map((r) => {
    const c = cardOf(r.s, r, bySample.get(r.s.id) ?? []);
    if (!r.s.url || r.s.approvedVersion === null) return c;
    return { ...c, photoChecks: markOnWeb(c.photoChecks ?? [], r.s.approvedVersion === r.s.version ? r.s.usedPhotos ?? [] : webNames.get(r.s.id) ?? []) };
  });
  return { cards, counts, total };
}

// ---- storage ---------------------------------------------------------------------------------------
// Peek's files share one bucket on Supabase's free plan: 1 GB for everything (the team's Files and the samples' photos
// and Approve copies). The Samples page shows the owner how much is used, from what the rows record (no bucket listing):
// each sample's uploaded photos, each Approve copy once (current and older versions; the oldest copies carry no
// size and count as 0), and the team's Files not deleted. Shells count with the samples that hold photos.
export const FREE_STORAGE = 1024 * 1024 * 1024;
export type StorageUse = { totalBytes: number; sampleBytes: number; fileBytes: number; samples: number };
export async function storageUse(d: Db, tenantId: string): Promise<StorageUse> {
  // the three reads side by side, one trip instead of three
  const [rows, old, [f]] = await Promise.all([
    d.select({ id: samples.id, photos: samples.photos, assets: samples.assets }).from(samples).where(eq(samples.tenantId, tenantId)),
    d.select({ sampleId: sampleVersions.sampleId, assets: sampleVersions.assets }).from(sampleVersions).where(eq(sampleVersions.tenantId, tenantId)),
    d.select({ n: sql<number>`coalesce(sum(${files.size}), 0)::bigint` }).from(files).where(and(eq(files.tenantId, tenantId), isNull(files.deletedAt))),
  ]);
  const seen = new Map<string, number>();
  const holding = new Set<string>();
  const count = (sampleId: string, key: string, bytes: unknown) => {
    if (!key || seen.has(key)) return;
    seen.set(key, Number(bytes) || 0);
    holding.add(sampleId);
  };
  for (const s of rows) {
    for (const p of (s.photos ?? []) as SamplePhoto[]) {
      count(s.id, p.key, p.bytes);
      if (p.original) count(s.id, p.original.key, p.original.bytes);
    }
    for (const a of (s.assets ?? []) as Asset[]) count(s.id, a.key, a.bytes);
  }
  for (const v of old) for (const a of (v.assets ?? []) as Asset[]) count(v.sampleId, a.key, a.bytes);
  const sampleBytes = [...seen.values()].reduce((n, b) => n + b, 0);
  const fileBytes = Number(f?.n ?? 0);
  return { totalBytes: sampleBytes + fileBytes, sampleBytes, fileBytes, samples: holding.size };
}

/** The drafts waiting for a person: the Samples badge in the bar. */
export async function draftCount(d: Db, tenantId: string): Promise<number> {
  const [r] = await d.select({ n: sql<number>`count(*)::int` }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.status, "draft")));
  return Number(r?.n ?? 0);
}

/** The stored page with its kind ("page": the Site Builder's own, "template"), for the preview's CSP. */
export async function sampleDoc(d: Db, tenantId: string, id: string, version?: number): Promise<{ html: string; kind: string; pages: { path: string; html: string }[] } | null> {
  if (version !== undefined) {
    const [v] = await d.select({ html: sampleVersions.html, kind: sampleVersions.kind, pages: sampleVersions.pages }).from(sampleVersions).where(and(eq(sampleVersions.tenantId, tenantId), eq(sampleVersions.sampleId, id), eq(sampleVersions.version, version)));
    if (v) return v;
  }
  const [r] = await d.select({ html: samples.html, kind: samples.kind, version: samples.version, pages: samples.pages }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, id)));
  if (!r || (version !== undefined && r.version !== version)) return null;
  return { html: r.html, kind: r.kind, pages: r.pages ?? [] };
}

export async function sampleHtml(d: Db, tenantId: string, id: string, version?: number): Promise<string | null> {
  if (version !== undefined) {
    const [v] = await d.select({ html: sampleVersions.html }).from(sampleVersions).where(and(eq(sampleVersions.tenantId, tenantId), eq(sampleVersions.sampleId, id), eq(sampleVersions.version, version)));
    if (v) return v.html;
  }
  const [r] = await d.select({ html: samples.html, version: samples.version }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, id)));
  if (!r || (version !== undefined && r.version !== version)) return null;
  return r.html;
}

export type VersionLine = { version: number; status: string; madeBy: string; madeAt: string; current: boolean;
  /** How many photos this version shows that Peek no longer holds, so the version says so. */
  photosGone: number };
/** A sample's versions, newest first: the current one, then each kept one. */
export async function sampleVersionsOf(d: Db, tenantId: string, id: string): Promise<VersionLine[]> {
  // the two reads side by side, one trip instead of two
  const [[s], old] = await Promise.all([
    d.select({ ...listCols, html: samples.html, pages: samples.pages, photos: samples.photos }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, id))),
    d.select({ version: sampleVersions.version, status: sampleVersions.status, madeBy: sampleVersions.madeBy, madeAt: sampleVersions.madeAt, html: sampleVersions.html, pages: sampleVersions.pages })
      .from(sampleVersions).where(and(eq(sampleVersions.tenantId, tenantId), eq(sampleVersions.sampleId, id))).orderBy(desc(sampleVersions.version)).limit(50),
  ]);
  if (!s) return [];
  const held = new Set(((s.photos ?? []) as SamplePhoto[]).map((p) => p.name));
  const gone = (html: string, pages: { html: string }[] | null) => new Set(photoRefs([html, ...(pages ?? []).map((p) => p.html)].join("\n")).filter((n) => !held.has(n))).size;
  return [{ version: s.version, status: s.status, madeBy: s.draftedBy, madeAt: s.updatedAt.toISOString(), current: true, photosGone: gone(s.html, s.pages) },
    ...old.map(({ html, pages, ...v }) => ({ ...v, madeAt: v.madeAt.toISOString(), current: false, photosGone: gone(html, pages) }))];
}

export type Review = "approve" | "changes" | "takedown" | "hold" | "release" | "reject";
/** Where Approve keeps a builder page's pictures; injected by the tests. */
export type AssetStore = { put: (key: string, bytes: Uint8Array, type: string) => Promise<void>; get?: typeof fetch };
/** A person's decision: approve (samples.review), send back with a note for the agent (a draft goes to changes_requested;
 *  a frozen approved or live sample keeps its status and carries the note), take down, or hold / release (owner or
 *  manager: a held sample is never published, whatever its status). */
/** A sample that comes down (taken down, rejected, withdrawn, expired) is no reference any more: its mark is
 *  removed under the tenant row's lock. */
async function dropReference(d: Db, tenantId: string, sampleId: string): Promise<void> {
  await updateSettings(d, tenantId, (now) => {
    const list = Array.isArray(now.sampleReferences) ? now.sampleReferences : [];
    return list.some((r) => r.sampleId === sampleId) ? { sampleReferences: list.filter((r) => r.sampleId !== sampleId), sampleReferencesAt: new Date().toISOString() } : {};
  });
}

/** A take-down's record, in the same write that removes its Reference mark, so undo can put the mark back. */
async function recordTakedown(d: Db, tenantId: string, sampleId: string, r: { reason: string; asked: boolean; by: string; at: Date }): Promise<void> {
  await updateSettings(d, tenantId, (now) => {
    const marks = Array.isArray(now.sampleReferences) ? now.sampleReferences : [];
    const mark = marks.find((x) => x.sampleId === sampleId);
    const entry = { sampleId, reason: cleanReason(r.reason), asked: r.asked, by: r.by.slice(0, 80), at: r.at.toISOString(),
      ...(mark ? { reference: { version: mark.version, family: mark.family, setAt: mark.setAt, setBy: mark.setBy } } : {}) };
    return { sampleTakedowns: withTakedown(now.sampleTakedowns, entry), ...(mark ? { sampleReferences: marks.filter((x) => x !== mark), sampleReferencesAt: new Date().toISOString() } : {}) };
  });
}

/** A taken-down sample goes back to where it was, its versions untouched: approved (the publisher puts it up at the
 *  same address and it reads live again), or, when a newer version was waiting, that draft with the approved version served.
 *  Refused while it is still coming off the web, when the business has a website, when anything the approved version shows is
 *  gone, and, when the business or a photographer asked for the take-down, until a person says they checked with them. */
export async function undoTakedown(d: Db, tenantId: string, id: string, who: { name: string }, cleared = false, now = new Date()): Promise<SampleRow> {
  return d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [s] = await t.select().from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, id))).for("update");
    if (!s || s.status === SHELL) throw new SampleError(404, "no such sample");
    if (s.status !== "taken_down") throw new SampleError(409, `only a taken-down sample comes back; this one is ${s.status.replace("_", " ")}`);
    if (s.url) throw new SampleError(409, "it is still coming off the web: undo it after the publisher's next run");
    const approved = s.approvedVersion;
    if (approved === null) throw new SampleError(409, "no version of it was approved, so there is nothing to put back");
    const [l] = await t.select({ website: leads.website }).from(leads).where(eq(leads.id, s.leadId));
    if ((l?.website ?? "").trim()) throw new SampleError(409, "the business has a website now, so its sample does not go back up");
    const waiting = approved !== s.version;
    const [kept] = waiting ? await t.select({ html: sampleVersions.html, pages: sampleVersions.pages, assets: sampleVersions.assets }).from(sampleVersions)
      .where(and(eq(sampleVersions.sampleId, id), eq(sampleVersions.version, approved))) : [];
    if (waiting && !kept) throw new SampleError(409, `version ${approved} is no longer kept, so it cannot go back up`);
    const page = kept ?? s;
    const doc = [page.html, ...(page.pages ?? []).map((p) => p.html)].join("\n");
    const names = new Set(((s.photos ?? []) as SamplePhoto[]).map((p) => p.name));
    const copied = new Set(((page.assets ?? []) as Asset[]).map((a) => a.src));
    const gone = photoRefs(doc).filter((n) => !names.has(n)).length + outsideImages(doc).filter((u) => !copied.has(u)).length;
    if (gone) throw new SampleError(409, `${gone === 1 ? "1 picture" : `${gone} pictures`} of version ${approved} ${gone === 1 ? "is" : "are"} gone, so it cannot go back up as it was`);
    // a rejected photo never goes back on the web
    const no = photosRejected(reviewPhotos((s.photos ?? []) as SamplePhoto[], photoRefs(doc)));
    if (no) throw new SampleError(409, `${photoCount(no)} of version ${approved} ${no === 1 ? "was" : "were"} rejected, so it cannot go back up as it was`);
    const by = who.name.slice(0, 80);
    await updateSettings(t, tenantId, (cur) => {
      const open = openTakedown(cur.sampleTakedowns, id);
      if (open?.asked && !cleared) throw new SampleError(409, "the business or a photographer asked for this take-down: check with them first, then confirm");
      const marks = Array.isArray(cur.sampleReferences) ? cur.sampleReferences : [];
      const back = open?.reference && open.reference.version <= approved && !marks.some((m) => m.sampleId === id) ? { sampleId: id, ...open.reference } : null;
      return { sampleTakedowns: withUndo(cur.sampleTakedowns, id, by, now.toISOString()), ...(back ? { sampleReferences: [...marks, back], sampleReferencesAt: now.toISOString() } : {}) };
    });
    const asks = waiting ? await openRequestCount(t, tenantId, id) : 0;
    // publishedAt clears so its 30 days on the web start again when the publisher puts it up
    const [row] = await t.update(samples).set({ status: !waiting ? "approved" : asks || s.notComplete ? "changes_requested" : "draft", publishedAt: null, reviewedBy: by, reviewedAt: now, updatedAt: now })
      .where(eq(samples.id, id)).returning();
    return strip(row);
  });
}

/** The words when the version a person looked at is not the one waiting any more. */
const newerArrived = (now: number, seen: number) => new SampleError(409, `a newer version arrived (version ${now}; you looked at version ${seen}): look again before you approve`);
/** The words when an Approve meets an open request. */
const openRequestsRefused = (version: number, open: number) => new SampleError(409, `${openRequestsLine(version, open)}. Nothing was approved: the ${agentName("Site Builder")} answers ${open === 1 ? "it" : "them"}, or whoever filed ${open === 1 ? "it" : "one"}, the owner or a manager closes it first.`);

/** The words when an Approve meets a version that arrived incomplete. */
const notCompleteRefused = (version: number, reason: string) => new SampleError(409, `${notCompleteLine(version, reason)}. Nothing was approved: the ${agentName("Site Builder")} sends a complete version first.`);

export async function reviewSample(d: Db, tenantId: string, id: string, action: Review, who: { name: string; userId?: string | null }, note = "", store?: AssetStore | null,
  seen?: number, opts: { asked?: boolean } = {}): Promise<SampleRow> {
  const [s] = await d.select(listCols).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, id)));
  if (!s || s.status === SHELL) throw new SampleError(404, "no such sample");
  const set: Partial<typeof samples.$inferInsert> = { reviewedBy: who.name, reviewedAt: new Date(), updatedAt: new Date() };
  if (action === "hold" || action === "release") {
    const [row] = await d.update(samples).set({ hold: action === "hold", updatedAt: new Date() }).where(eq(samples.id, id)).returning();
    return strip(row);
  }
  if (action === "approve") {
    // nobody approves a version that arrived incomplete, whoever they are
    if (s.notComplete) throw notCompleteRefused(s.version, s.notComplete);
    // nobody approves past an open request; its filer, the owner or a manager can close it first
    if (["draft", "changes_requested"].includes(s.status)) {
      const asks = await openRequestCount(d, tenantId, id);
      if (asks) throw openRequestsRefused(s.version, asks);
    }
    if (s.status !== "draft") throw new SampleError(409, `only a draft is approved; this one is ${s.status.replace("_", " ")}`);
    // an Approve is for the version the person saw, never for one that replaced it meanwhile
    if (seen !== undefined && seen !== s.version) throw newerArrived(s.version, seen);
    set.status = "approved";
    set.approvedVersion = s.version; // this version stays on the web until a newer one is approved
    // a builder page's outside pictures are copied now, so the live page never loads an expiring link
    if (s.kind === "page") {
      const [h0] = await d.select({ html: samples.html, pages: samples.pages, version: samples.version, photos: samples.photos }).from(samples).where(eq(samples.id, id));
      if (!h0 || h0.version !== s.version) throw newerArrived(h0?.version ?? s.version, seen ?? s.version);
      // the extra pages' pictures are copied with the main page's, into the one assets/ folder
      const h = h0 && { html: [h0.html, ...(h0.pages ?? []).map((pg) => pg.html)].join("\n") };
      // the person at Approve is the only check on what a photo shows, so every picture must be one they could see
      const raw = outsideImages(h?.html ?? "").length;
      if (raw) throw new SampleError(409, `${raw === 1 ? "1 picture" : `${raw} pictures`} on this page ${raw === 1 ? "was" : "were"} not uploaded through Peek, so nobody can check ${raw === 1 ? "it" : "them"}. Nothing was approved: the ${agentName("Site Builder")} has to upload ${raw === 1 ? "it" : "them"} first.`);
      // every photo accepted; a rejected one goes back to the builder, never up
      const decided = reviewPhotos((h0.photos ?? []) as SamplePhoto[], photoRefs(h?.html ?? ""));
      const no = photosRejected(decided);
      if (no) throw new SampleError(409, `${photoCount(no)} on this page ${no === 1 ? "was" : "were"} rejected. Nothing was approved: send ${no === 1 ? "it" : "them"} back so the next version drops ${no === 1 ? "it" : "them"}.`);
      const left = photosLeft(decided);
      if (left) throw new SampleError(409, `${photoCount(left)} still ${left === 1 ? "needs" : "need"} Accept or Reject. Nothing was approved.`);
      set.assets = [];
    }
  } else if (action === "reject") {
    // a person's no: the lead leaves the Site Builder's queue; the reason (optional) is what it reads next time
    if (!["draft", "changes_requested"].includes(s.status)) throw new SampleError(409, `only a draft is rejected; this one is ${s.status.replace("_", " ")}`);
    // an approved version is on the web: rejecting the newer draft would drop the whole site with it
    if (s.approvedVersion !== null) throw new SampleError(409, `version ${s.approvedVersion} is on the web: send this draft back with a note, or take the site down`);
    set.status = "rejected";
    set.note = note.replace(/\s+/g, " ").trim().slice(0, 500);
  } else if (action === "changes") {
    // on any sample not rejected or taken down, each request its own record (lib: recordRequest)
    // the signed-in person's id, from the session; it is what makes the request a person's
    return (await recordRequest(d, tenantId, id, { text: note, byName: who.name, byUser: who.userId ?? null })).sample;
  } else {
    set.status = "taken_down";
  }
  // the Approve lands only on the version it was checked against (a draft landing meanwhile wins, and the
  // pictures copied for the older one are removed again)
  // nor past a request filed since the check above
  const noneOpen = sql`not exists (select 1 from "sample_requests" r where r.sample_id = "samples"."id" and r.status = 'open')`;
  const only = action === "approve" ? and(eq(samples.id, id), eq(samples.version, s.version), eq(samples.status, "draft"), eq(samples.notComplete, ""), noneOpen) : eq(samples.id, id);
  // a person's Approve is also their word on what the rounds claimed, in the same write. An auto-approve is nobody's word
  const [row] = await d.transaction(async (tx) => {
    const out = await tx.update(samples).set(set).where(only).returning();
    if (out[0] && action === "approve" && who.userId) await tx.update(sampleRequests).set({ status: "answered" }).where(and(eq(sampleRequests.tenantId, tenantId), eq(sampleRequests.sampleId, id), eq(sampleRequests.status, "addressed")));
    return out;
  });
  if (!row) {
    const rm = await storage().then((st) => (st ? (k: string) => st.remove(k) : null)).catch(() => null);
    for (const a of (set.assets ?? []) as Asset[]) if (rm) await rm(a.key).catch(() => undefined);
    const asksNow = action === "approve" ? await openRequestCount(d, tenantId, id) : 0;
    if (asksNow) throw openRequestsRefused(s.version, asksNow);
    const [now] = await d.select({ version: samples.version }).from(samples).where(eq(samples.id, id));
    throw newerArrived(now?.version ?? s.version, seen ?? s.version);
  }
  // a take-down keeps who, when, the optional reason and the mark it removed, so it can be undone
  if (row.status === "taken_down") await recordTakedown(d, tenantId, id, { reason: note, asked: !!opts.asked, by: who.name, at: row.reviewedAt ?? new Date() });
  else if (row.status === "rejected") await dropReference(d, tenantId, id);
  return strip(row);
}

/** The owner's note from the dashboard's Decisions box (the one-site focus): what the
 *  Site Builder should work on next. A draft goes back for changes with it; a sent-back draft takes it as its note; an approved or live
 *  page keeps its status and carries it as its changes note. Either way the Site Builder's queue lists it as "changes".
 *  Taken-down and rejected samples answer 409. */
export async function ownerNote(d: Db, tenantId: string, id: string, raw: string, by: string): Promise<SampleRow> {
  // the Decisions box's answer is a change request like any other, kept as its own record
  if (!raw.replace(/\s+/g, " ").trim()) throw new SampleError(400, `send the note: what the ${agentName("Site Builder")} should work on next`);
  return (await recordRequest(d, tenantId, id, { text: raw, byName: by.slice(0, 80) })).sample;
}

// ---- change requests -----------------------------------------------------------------------------
export const REQUEST_MAX = 1000;
export const REQUEST_PICTURES = 3;
export type RequestPicture = { n: number; key: string; type: string; bytes: number };
export type SampleRequest = typeof sampleRequests.$inferSelect;

/** How many of a sample's change requests are open. */
export async function openRequestCount(d: Db, tenantId: string, sampleId: string): Promise<number> {
  const [r] = await d.select({ n: sql<number>`count(*)::int` }).from(sampleRequests).where(and(eq(sampleRequests.tenantId, tenantId), eq(sampleRequests.sampleId, sampleId), eq(sampleRequests.status, "open")));
  return Number(r?.n ?? 0);
}

/** A person's change request, its own record: on a draft it sends the draft back (changes_requested); on an approved or
 *  live sample the status stays and the request waits for the next version. The sample's note (and on an approved or live
 *  one its changes note) mirror the newest request, so a reader of the older fields still sees it. The pictures are
 *  stored already (lib/sample-requests.ts). */
/** Whether a change request can be taken (its text, and a sample that takes a next version) -- checked before
 *  any of its pictures is stored. */
export async function requestable(d: Db, tenantId: string, sampleId: string, raw: string): Promise<{ text: string; s: SampleRow }> {
  const text = raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new SampleError(400, `say what to change: the request goes to the ${agentName("Site Builder")}`);
  if (text.length > REQUEST_MAX) throw new SampleError(400, `a request is at most ${REQUEST_MAX} characters`);
  const [s] = await d.select(listCols).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, sampleId)));
  if (!s || s.status === SHELL) throw new SampleError(404, "no such sample");
  if (s.status === "rejected" || s.status === "taken_down") throw new SampleError(409, `this sample is ${s.status.replace("_", " ")}: no next version`);
  return { text, s };
}

export async function recordRequest(d: Db, tenantId: string, sampleId: string, r: { text: string; byName: string; byUser?: string | null; pictures?: RequestPicture[]; id?: string }):
  Promise<{ request: SampleRequest; sample: SampleRow }> {
  const { text, s } = await requestable(d, tenantId, sampleId, r.text);
  const now = new Date();
  const [request] = await d.insert(sampleRequests).values({ ...(r.id ? { id: r.id } : {}), tenantId, sampleId, text, pictures: r.pictures ?? [], byName: r.byName.slice(0, 80), byUser: r.byUser ?? null, at: now, madeOnVersion: s.version }).returning();
  const one = text.replace(/\s+/g, " ").slice(0, 500);
  const set: Partial<typeof samples.$inferInsert> = { reviewedBy: r.byName.slice(0, 80), reviewedAt: now, updatedAt: now, note: one };
  if (s.status === "draft" || s.status === "changes_requested") set.status = "changes_requested";
  else set.changesNote = one;
  const [row] = await d.update(samples).set(set).where(eq(samples.id, sampleId)).returning();
  return { request, sample: strip(row) };
}

/** Pure: which of the open requests a version's `answers` closes (the rule below). */
function answeredBy(open: { id: string }[], answers: unknown): string[] {
  const want = new Set(Array.isArray(answers) ? answers.filter((x): x is string => typeof x === "string") : []);
  return open.filter((r) => want.has(r.id)).map((r) => r.id);
}

/** The requests a new version answers (a newer version alone closes nothing): a list -- exactly those
 *  open ones; missing or [] -- none. Answers their ids. */
export async function answerRequests(d: Db, tenantId: string, sampleId: string, version: number, answers: unknown, now = new Date()): Promise<string[]> {
  const open = await d.select({ id: sampleRequests.id }).from(sampleRequests)
    .where(and(eq(sampleRequests.tenantId, tenantId), eq(sampleRequests.sampleId, sampleId), eq(sampleRequests.status, "open")));
  const ids = answeredBy(open, answers);
  // a round's word is a claim. It stays "addressed" until a person's Approve or Done confirms it, or Not done sends it back
  if (ids.length) await d.update(sampleRequests).set({ status: "addressed", answeredVersion: version, answeredAt: now }).where(and(eq(sampleRequests.tenantId, tenantId), inArray(sampleRequests.id, ids)));
  return ids;
}

/** A request a round claimed goes back to open, with the claim cleared, and a draft goes back so the next refine turn takes
 *  it. A signed-in person may do this anywhere. A key may not on a sample with an approved version: an open request from a person is
 *  what lets a live site take a new version, so a key's reopen would pass for a person's yes. A key can never confirm a request. */
export async function reopenRequest(d: Db, tenantId: string, sampleId: string, requestId: string, person: { name: string } | null, now = new Date()): Promise<{ open: number; status: string }> {
  return d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [s] = await t.select({ status: samples.status, approvedVersion: samples.approvedVersion }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, sampleId))).for("update");
    if (!s || s.status === SHELL) throw new SampleError(404, "no such sample");
    if (s.status === "rejected" || s.status === "taken_down") throw new SampleError(409, `this sample is ${s.status.replace("_", " ")}: its requests stay as they are`);
    if (!person && (s.approvedVersion !== null || s.status === "approved" || s.status === "live")) throw new SampleError(403, "this sample has an approved version: only a signed-in person can send a request back");
    const [r] = await t.select({ status: sampleRequests.status }).from(sampleRequests).where(and(eq(sampleRequests.tenantId, tenantId), eq(sampleRequests.sampleId, sampleId), eq(sampleRequests.id, requestId)));
    if (!r) throw new SampleError(404, "no such request");
    if (r.status !== "addressed") throw new SampleError(409, `this request is ${r.status}: only one a round claimed can be sent back`);
    await t.update(sampleRequests).set({ status: "open", answeredVersion: null, answeredAt: null }).where(and(eq(sampleRequests.tenantId, tenantId), eq(sampleRequests.id, requestId)));
    const still = await t.select({ text: sampleRequests.text }).from(sampleRequests)
      .where(and(eq(sampleRequests.tenantId, tenantId), eq(sampleRequests.sampleId, sampleId), eq(sampleRequests.status, "open"))).orderBy(desc(sampleRequests.at));
    const one = still[0]?.text.replace(/\s+/g, " ").slice(0, 500) ?? "";
    const up = s.status === "approved" || s.status === "live";
    const status = s.status === "draft" ? "changes_requested" : s.status;
    await t.update(samples).set({ status, note: one, ...(up ? { changesNote: one } : {}), ...(person ? { reviewedBy: person.name.slice(0, 80), reviewedAt: now } : {}), updatedAt: now }).where(eq(samples.id, sampleId));
    return { open: still.length, status };
  });
}

/** After a new version: the sample's notes mirror the newest request still open (or clear the changes note). */
async function mirrorNote(d: Db, tenantId: string, row: typeof samples.$inferSelect): Promise<typeof samples.$inferSelect> {
  const [newest] = await d.select({ text: sampleRequests.text }).from(sampleRequests)
    .where(and(eq(sampleRequests.tenantId, tenantId), eq(sampleRequests.sampleId, row.id), eq(sampleRequests.status, "open"))).orderBy(desc(sampleRequests.at)).limit(1);
  if (!newest) return row;
  const one = newest.text.replace(/\s+/g, " ").slice(0, 500);
  const [r] = await d.update(samples).set({ note: one, ...(row.status === "approved" || row.status === "live" ? { changesNote: one } : {}) }).where(eq(samples.id, row.id)).returning();
  return r;
}

/** A person ends an open request: "done" (this version does it) or "withdraw" (it is no longer wanted). Only its
 *  filer, the owner or a manager. When the last open one ends, a sample sent back waits for a person's Approve again and an
 *  approved or live one leaves the builder's list; nothing here approves or publishes. */
export async function closeRequest(d: Db, tenantId: string, sampleId: string, requestId: string, how: "done" | "withdraw", who: { name: string; userId: string; role: string }, now = new Date()): Promise<{ left: number; status: string }> {
  return d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [s] = await t.select({ status: samples.status, version: samples.version, notComplete: samples.notComplete }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, sampleId))).for("update");
    if (!s || s.status === SHELL) throw new SampleError(404, "no such sample");
    if (s.status === "rejected" || s.status === "taken_down") throw new SampleError(409, `this sample is ${s.status.replace("_", " ")}: its requests stay as they are`);
    const [r] = await t.select({ status: sampleRequests.status, byUser: sampleRequests.byUser }).from(sampleRequests)
      .where(and(eq(sampleRequests.tenantId, tenantId), eq(sampleRequests.sampleId, sampleId), eq(sampleRequests.id, requestId)));
    if (!r) throw new SampleError(404, "no such request");
    // a person's Done also confirms what a round claimed, keeping the version that claimed it
    const claimed = r.status === "addressed" && how === "done";
    if (r.status !== "open" && !claimed) throw new SampleError(409, `this request is already ${r.status}`);
    if (!canCloseRequest(who, r)) throw new SampleError(403, "only the person who filed this request, the owner or a manager can close it");
    await t.update(sampleRequests).set(claimed ? { status: "answered" } : how === "done" ? { status: "answered", answeredVersion: s.version, answeredAt: now } : { status: "withdrawn" })
      .where(and(eq(sampleRequests.tenantId, tenantId), eq(sampleRequests.id, requestId)));
    const still = await t.select({ text: sampleRequests.text }).from(sampleRequests)
      .where(and(eq(sampleRequests.tenantId, tenantId), eq(sampleRequests.sampleId, sampleId), eq(sampleRequests.status, "open"))).orderBy(desc(sampleRequests.at));
    const one = still[0]?.text.replace(/\s+/g, " ").slice(0, 500) ?? "";
    const up = s.status === "approved" || s.status === "live";
    // closing the last request does not make an incomplete version ready; its reason stays what the builder reads
    const status = !still.length && s.status === "changes_requested" && !s.notComplete ? "draft" : s.status;
    await t.update(samples).set({ status, note: one || s.notComplete, ...(up ? { changesNote: one } : {}), reviewedBy: who.name.slice(0, 80), reviewedAt: now, updatedAt: now }).where(eq(samples.id, sampleId));
    return { left: still.length, status };
  });
}

/** A sample's requests, newest first (at most 50), optionally only the open ones. */
export async function requestsOf(d: Db, tenantId: string, sampleId: string, status?: string): Promise<SampleRequest[]> {
  const where = [eq(sampleRequests.tenantId, tenantId), eq(sampleRequests.sampleId, sampleId)];
  if (status) where.push(eq(sampleRequests.status, status));
  return d.select().from(sampleRequests).where(and(...where)).orderBy(desc(sampleRequests.at)).limit(50);
}

// ---- deleting and reopening -------------------------------------------------------------
export const DELETABLE = ["taken_down", "rejected"];

// ---- shells -----------------------------------------------------------------------------------------
// A sample's photos may come before its first page: the first upload for a lead with no sample makes a "shell" -- no html,
// version 0, its photos only. A shell is shown nowhere a person looks (not on Samples, not in a count, not in the publish
// queue); the lead stays in the Site Builder's queue, and its first page fills the shell as version 1 (saveDraft). A shell
// with no version after SHELL_DAYS is removed with its photos (the Site Builder's queue read sweeps them).
export const SHELL = "shell";
export const SHELL_DAYS = 7;

/** The lead's sample to upload a photo to: its sample, else a new shell. Refused as saveDraft refuses a first page. */
export async function sampleForPhotos(d: Db, tenantId: string, leadId: string, by: string, now = new Date()): Promise<{ id: string; shell: boolean }> {
  // two first uploads at once make one shell -- the find-or-make holds a lock on the lead
  return d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.execute(sql`select pg_advisory_xact_lock(hashtext(${`sample-shell:${leadId}`}))`);
    return findOrMakeShell(t, tenantId, leadId, by, now);
  });
}
async function findOrMakeShell(d: Db, tenantId: string, leadId: string, by: string, now: Date): Promise<{ id: string; shell: boolean }> {
  const latest = async () => (await d.select({ id: samples.id, status: samples.status }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.leadId, leadId)))
    .orderBy(desc(samples.version), asc(samples.createdAt), asc(samples.id)).limit(1))[0];
  const had = await latest();
  if (had) return { id: had.id, shell: had.status === SHELL };
  const [lead] = await d.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
  if (!lead) throw new SampleError(404, "no such lead");
  if ((lead.website ?? "").trim()) throw new SampleError(409, "this business has a website: a sample is only for one without");
  if (await deletedOpen(d, tenantId, leadId)) throw new SampleError(409, "the owner deleted this lead's sample: reopen it first (POST /v1/samples/reopen)");
  await d.insert(samples).values({ tenantId, leadId, slug: sampleSlug(lead.business, areaOf(lead)), template: pickFamily(lead.industry, listingFacts(lead.listingEvidence).kind),
    html: "", status: SHELL, version: 0, kind: "page", draftedBy: by.slice(0, 80), frozenAt: FROZEN_RESULTS.includes(lead.result ?? "") ? now : null, createdAt: now, updatedAt: now });
  const [made] = await d.select({ id: samples.id }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.leadId, leadId), eq(samples.status, SHELL)))
    .orderBy(asc(samples.createdAt), asc(samples.id)).limit(1);
  return { id: made.id, shell: true };
}

/** PUT /v1/samples/by-lead/<lead>/photos/<name>: the picture is checked and storage found before a shell is made, so a
 *  refused upload leaves nothing behind. */
export async function putLeadPhoto(d: Db, tenantId: string, leadId: string, name: string, bytes: Uint8Array, meta: { guest?: boolean; dish: string; by: string },
  store?: Pick<AssetStore, "put"> | null): Promise<{ sampleId: string; shell: boolean; photos: SamplePhoto[] }> {
  const problem = uploadProblem(name, bytes, []);
  if (problem) throw new SampleError(400, problem);
  const st = store === undefined ? await defaultAssetStore() : store;
  if (!st) throw new SampleError(503, "file storage is not set up, so the photo cannot be kept");
  const s = await sampleForPhotos(d, tenantId, leadId, meta.by);
  return { sampleId: s.id, shell: s.shell, photos: await putSamplePhoto(d, tenantId, s.id, name, bytes, meta, st) };
}

/** Shells older than SHELL_DAYS that never got a page: removed, their photo files too (best effort). Returns how many. */
export async function dropOldShells(d: Db, tenantId: string, now = new Date(), remove?: ((key: string) => Promise<void>) | null): Promise<number> {
  const cut = new Date(now.getTime() - SHELL_DAYS * 86_400_000);
  // counted from the last upload (each upload moves updatedAt), and only the rows this delete removed lose
  // their files (a shell filled by a page meanwhile is no shell any more and keeps them)
  const gone = and(eq(samples.tenantId, tenantId), eq(samples.status, SHELL), lt(samples.updatedAt, cut));
  const old = await d.delete(samples).where(gone).returning();
  if (!old.length) return 0;
  const rm = remove === undefined ? await storage().then((st) => (st ? (k: string) => st.remove(k) : null)) : remove;
  for (const p of old.flatMap((o) => (o.photos ?? []) as SamplePhoto[])) {
    if (!rm) break;
    await rm(p.key).catch((err) => console.error("samples.shell photo", p.key, err instanceof Error ? err.message : err));
  }
  return old.length;
}
async function deletedOpen(d: Db, tenantId: string, leadId: string) {
  const [x] = await d.select({ id: sampleDeletions.id }).from(sampleDeletions)
    .where(and(eq(sampleDeletions.tenantId, tenantId), eq(sampleDeletions.leadId, leadId), isNull(sampleDeletions.reopenedAt))).limit(1);
  return !!x;
}

/** The owner deletes a dead sample (taken down or rejected only): its versions, its row, and the pictures Approve copied;
 *  one audit line in sample_deletions (who, when, slug, business, how many versions), which also keeps the lead out of the
 *  Site Builder's queue. The lead itself is untouched. `remove` deletes a stored file (best effort, after the rows). */
export async function deleteSample(d: Db, tenantId: string, id: string, by: string, remove?: ((key: string) => Promise<void>) | null):
  Promise<{ slug: string; versions: number; files: number }> {
  const [s] = await d.select({ s: listCols, business: leads.business }).from(samples).innerJoin(leads, eq(leads.id, samples.leadId))
    .where(and(eq(samples.tenantId, tenantId), eq(samples.id, id)));
  if (!s) throw new SampleError(404, "no such sample");
  if (!DELETABLE.includes(s.s.status)) throw new SampleError(409, `only a taken-down or rejected sample is deleted; this one is ${s.s.status.replace("_", " ")}`);
  if (s.s.url) throw new SampleError(409, "it is still coming off the web: delete it after the next publish run");
  const kept = await d.select({ v: sampleVersions.version, assets: sampleVersions.assets }).from(sampleVersions).where(and(eq(sampleVersions.tenantId, tenantId), eq(sampleVersions.sampleId, id)));
  const versions = kept.length + 1;
  // every version's copied pictures and the change requests' pictures go too, not only the
  // current row's (each key once)
  const asks = await d.select({ pictures: sampleRequests.pictures }).from(sampleRequests).where(and(eq(sampleRequests.tenantId, tenantId), eq(sampleRequests.sampleId, id)));
  const keys = [...new Set([...((s.s.assets ?? []) as Asset[]), ...kept.flatMap((v) => (v.assets ?? []) as Asset[]), ...((s.s.photos ?? []) as SamplePhoto[]),
    ...asks.flatMap((q) => q.pictures ?? [])].map((a) => a.key).filter(Boolean))];
  await d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.insert(sampleDeletions).values({ tenantId, leadId: s.s.leadId, sampleId: id, slug: s.s.slug, business: s.business.split(" | ")[0].trim().slice(0, 200), versions, deletedBy: by.slice(0, 80) });
    await t.delete(sampleVersions).where(and(eq(sampleVersions.tenantId, tenantId), eq(sampleVersions.sampleId, id)));
    await t.delete(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, id)));
  });
  let files = 0;
  const rm = remove === undefined ? await storage().then((st) => (st ? (k: string) => st.remove(k) : null)) : remove;
  // its copied pictures (every version), its uploaded photos and its requests' pictures
  for (const key of keys) {
    if (!rm) break;
    await rm(key).then(() => files++, (err) => console.error("samples.delete asset", key, err instanceof Error ? err.message : err));
  }
  return { slug: s.s.slug, versions, files };
}

/** Reopen a lead's sample for the Site Builder (the owner's focus pick may be a dead one): a taken-down or
 *  rejected sample goes back as sent back for a new page (the queue lists it as "changes"); a deleted one is cleared so a
 *  page can be posted for the lead again. Anything else is already open (409). */
export async function reopenSample(d: Db, tenantId: string, leadId: string, by: string): Promise<{ reopened: "sample" | "deleted"; sample: SampleRow | null }> {
  const [s] = await d.select(listCols).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.leadId, leadId))).orderBy(desc(samples.version)).limit(1);
  if (s) {
    if (!DELETABLE.includes(s.status)) throw new SampleError(409, `this lead's sample is ${s.status.replace("_", " ")}: already open`);
    if (s.url) throw new SampleError(409, "it is still coming off the web: reopen it after the next publish run");
    const note = `Reopened by ${by.slice(0, 80)}: make a new page`;
    const [row] = await d.update(samples).set({ status: "changes_requested", note, changesNote: "", hold: false, frozenAt: null, reviewedBy: by.slice(0, 80), reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(samples.id, s.id)).returning();
    return { reopened: "sample", sample: strip(row) };
  }
  const gone = await d.update(sampleDeletions).set({ reopenedBy: by.slice(0, 80), reopenedAt: new Date() })
    .where(and(eq(sampleDeletions.tenantId, tenantId), eq(sampleDeletions.leadId, leadId), isNull(sampleDeletions.reopenedAt))).returning();
  if (!gone.length) throw new SampleError(404, "this lead has no sample to reopen");
  return { reopened: "deleted", sample: null };
}

// ---- the Site Builder's queue ----------------------------------------------------------------------------------
export const QUEUE_ORDER = ["pack", "changes", "replied", "recopy", "backlog"] as const;
export type QueueReason = (typeof QUEUE_ORDER)[number];
export type QueueItem = { leadId: string; sampleId: string | null; reason: QueueReason; family: Family; facts: QueueFacts; note?: string };
const SWEEP = 5;

/** What the Site Builder makes next, in order: leads in a person's send pack (claimed, not sent) with no sample; samples a
 *  person sent back; Starter Website leads that answered with no sample; samples whose copy is out of date; then every
 *  no-site lead with a package and no sample, oldest first. Held samples and archived or website rows are left out; one
 *  item per lead. On the way it freezes the samples of leads that answered and re-renders a few whose facts changed
 *  without a lead write here (an import). */
export async function sampleQueue(d: Db, tenantId: string, limitIn = 20, getMap: (area: string) => Promise<string> = (a) => areaMap(a)): Promise<QueueItem[]> {
  const limit = Math.min(Math.max(Math.floor(Number(limitIn) || 20), 1), 100);
  const noSite = or(isNull(leads.website), eq(leads.website, ""));
  const open = and(eq(leads.tenantId, tenantId), eq(leads.archived, false), noSite);
  // no sample, and none the owner deleted (a deleted sample's lead stays out until it is reopened)
  // a shell (photos only) is no sample: its lead stays in the queue for its first page
  const noSample = sql`not exists (select 1 from ${samples} where ${samples.leadId} = ${leads.id} and ${samples.status} <> ${SHELL})
    and not exists (select 1 from ${sampleDeletions} where ${sampleDeletions.leadId} = ${leads.id} and ${sampleDeletions.reopenedAt} is null)`;
  // leads that answered before this was built: frozen now
  await d.update(samples).set({ frozenAt: new Date() }).where(and(eq(samples.tenantId, tenantId), isNull(samples.frozenAt), ne(samples.status, "taken_down"),
    sql`${samples.leadId} in (select ${leads.id} from ${leads} where ${leads.tenantId} = ${tenantId} and ${leads.result} in ('Replied', 'Meeting'))`));
  const sams = await d.select({ s: listCols, l: leads }).from(samples).innerJoin(leads, eq(leads.id, samples.leadId))
    .where(and(eq(samples.tenantId, tenantId), notInArray(samples.status, ["taken_down", "rejected", SHELL]), eq(leads.archived, false), noSite));
  await dropOldShells(d, tenantId);
  let swept = 0;
  for (const { s, l } of sams) {
    if (swept >= SWEEP || s.kind === "page" || s.frozenAt || !s.factsHash || s.factsHash === factsHash(l)) continue;
    await rerenderFacts(d, tenantId, l.id, getMap);
    swept++;
  }
  const price = await starterPrice(d, tenantId);
  const held = new Set((await d.select({ lead: samples.leadId }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.hold, true)))).map((r) => r.lead));
  const out: QueueItem[] = [];
  const seen = new Set<string>();
  const push = (l: Row, reason: QueueReason, sampleId: string | null = null, note?: string) => {
    if (out.length >= limit || seen.has(l.id) || held.has(l.id)) return;
    seen.add(l.id);
    out.push({ leadId: l.id, sampleId, reason, family: pickFamily(l.industry, listingFacts(l.listingEvidence).kind), facts: { ...factsOf(l), footer: sampleFooter(l.business, price) }, ...(note ? { note } : {}) });
  };
  const room = () => limit - out.length + seen.size;
  const pack = await d.select({ l: leads }).from(claims).innerJoin(leads, and(eq(leads.tenantId, claims.tenantId), eq(sql`${leads.id}::text`, claims.pageId)))
    .where(and(eq(claims.tenantId, tenantId), open, isNull(leads.sentAt), noSample)).orderBy(asc(claims.at)).limit(room());
  for (const { l } of pack) push(l, "pack");
  for (const { s, l } of sams) if (s.status === "changes_requested" || s.changesNote) push(l, "changes", s.id, s.changesNote || s.note);
  if (out.length < limit) {
    const replied = await d.select().from(leads).where(and(open, inArray(leads.result, FROZEN_RESULTS), ilike(leads.package, "Starter Website%"), noSample))
      .orderBy(sql`${leads.resultDate} asc nulls last`).limit(room());
    for (const l of replied) push(l, "replied");
  }
  // out of date: a template page's copy, or a builder page's facts or site facts (Peek never re-renders one)
  for (const { s, l } of sams) {
    const old = s.kind === "page" ? !!s.factsHash && s.factsHash !== pageFactsHash(l) : !!s.copyHash && s.copyHash !== copyHash(l);
    if (!s.frozenAt && old && s.status !== "changes_requested") push(l, "recopy", s.id);
  }
  // a template draft still waiting once the Enricher's site facts are in: the Site Builder writes it a page (the
  // older template drafts come back this way)
  for (const { s, l } of sams) if (s.kind !== "page" && s.status === "draft" && !s.frozenAt && l.siteFacts) push(l, "recopy", s.id);
  if (out.length < limit) {
    const backlog = await d.select().from(leads).where(and(open, isNotNull(leads.package), ne(leads.package, ""), noSample)).orderBy(asc(leads.createdAt)).limit(room());
    for (const l of backlog) push(l, "backlog");
  }
  return out;
}

// ---- publishing -----------------------------------------------------------------------------------
// The Cloudflare token stays on the Mac: scripts/samples-publish.py reads this queue, deploys every approved and live page to
// one Cloudflare Pages project, and reports back. A sample's url is set only once its page is up, and cleared once it is down.
export const EXPIRE_DAYS = 30;
export type PublishItem = { id: string; slug: string; status: string; version: number; url: string; publishedAt: string | null; expired: boolean; withdraw: boolean; hold: boolean; html: string;
  /** the extra pages, each deployed at <slug>/<path> (its pictures already point at ../assets/) */
  pages: { path: string; html: string }[];
  /** a builder page's pictures, copied at Approve: deploy each at <slug>/<path>; the html already points there */
  assets: { path: string; url: string }[];
  /** Changes when a grade-only replacement or a restore changes a file the served version uses; "" when none is graded.
   *  The publisher's signature takes it, because a photo-only change makes no new version. */
  photosRev: string };

/** A hash over each graded file the page uses, by name and bytes, so identical bytes uploaded again change nothing. */
export function photosRevOf(photos: SamplePhoto[], htmls: string[]): string {
  const used = new Set(htmls.flatMap(photoRefs));
  const lines = photos.filter((p) => used.has(p.name) && p.graded?.sha).map((p) => `${p.name}:${p.graded!.sha}`).sort();
  return lines.length ? sha256(lines.join("\n")) : "";
}

/** What should be up (approved and live; live past 30 days marked expired) and what must come down (taken down, still with a url). */
export async function publishQueue(d: Db, tenantId: string, now = new Date(), linkOf?: (key: string, type: string) => Promise<string>): Promise<PublishItem[]> {
  const raw = await d.select({ s: samples, website: leads.website }).from(samples).innerJoin(leads, eq(leads.id, samples.leadId))
    .where(and(eq(samples.tenantId, tenantId), inArray(samples.status, ["draft", "changes_requested", "approved", "live", "taken_down"])))
    .orderBy(desc(samples.updatedAt)).limit(500);
  // while a newer version waits (a draft, or sent back), the version approved before it stays on the web: it is
  // served from sample_versions with its own pages and copied pictures, listed as live (or approved, not yet up)
  // for approved and live rows too -- the web only ever gets the version a person (or Settings) approved
  const behind = (r: typeof samples.$inferSelect) => ["draft", "changes_requested", "approved", "live"].includes(r.status) && r.approvedVersion !== null && r.approvedVersion !== r.version;
  const waiting = raw.filter(({ s: r }) => behind(r));
  const kept0 = waiting.length
    ? await d.select({ sampleId: sampleVersions.sampleId, version: sampleVersions.version, html: sampleVersions.html, pages: sampleVersions.pages, assets: sampleVersions.assets, kind: sampleVersions.kind })
      .from(sampleVersions).where(and(eq(sampleVersions.tenantId, tenantId), inArray(sampleVersions.sampleId, waiting.map(({ s: r }) => r.id))))
    : [];
  const rows = raw.map((x) => {
    const r = x.s;
    if (!behind(r)) return x;
    const v = kept0.find((k) => k.sampleId === r.id && k.version === r.approvedVersion);
    // the approved version is not kept: nothing a person approved can be served, so nothing goes up
    if (!v) return { ...x, s: { ...r, status: r.url ? "live" : "approved", hold: true } };
    return { ...x, s: { ...r, status: r.url ? "live" : "approved", version: v.version, html: v.html, pages: v.pages ?? [], assets: v.assets ?? [], kind: v.kind } };
  });
  const cutoff = now.getTime() - EXPIRE_DAYS * 86400_000;
  // a business whose Website cell filled after its sample was made: the sample comes down, whatever its state (rule 7)
  const site = (w: string | null) => !!(w ?? "").trim();
  // a held sample is never put up; one already on the web is listed with hold: true and no html, to come down
  // a page showing any photo goes up only after a person approved it (never by autoPublish)
  const guestWait = (r: typeof samples.$inferSelect) => (!r.reviewedBy || r.reviewedBy === AUTO) && photoRefs([r.html, ...(r.pages ?? []).map((pg) => pg.html)].join("\n")).length > 0;
  // a page not on the web yet never goes up with a rejected photo (one already up stays until its fix is approved)
  const rejectWait = (r: typeof samples.$inferSelect) => !r.url && photosRejected(reviewPhotos((r.photos ?? []) as SamplePhoto[], photoRefs([r.html, ...(r.pages ?? []).map((pg) => pg.html)].join("\n")))) > 0;
  const kept = rows.filter(({ s: r, website }) => (r.status === "taken_down" || r.hold || guestWait(r) || rejectWait(r) ? !!r.url : ["approved", "live"].includes(r.status) || site(website)));
  let link = linkOf;
  if (!link && kept.some(({ s: r }) => r.assets?.length || r.photos?.length)) {
    const st = await storage();
    link = st ? (key, type) => st.downloadUrl(key, key.split("/").pop() ?? "asset", type, true, "") : undefined;
  }
  const out: PublishItem[] = [];
  for (const { s: r, website } of kept) {
    const up = !(r.status === "taken_down" || r.hold || site(website) || guestWait(r));
    // a builder page goes up as the person approved it, its pictures from its own assets/ folder; its edited
    // photos as more of that folder, numbered after the copies
    const copied = (up ? (r.assets ?? []) : []) as Asset[];
    const photos = up ? photoAssets((r.photos ?? []) as SamplePhoto[], [r.html, ...(r.pages ?? []).map((pg) => pg.html)], copied.length) : [];
    const assets = [...copied, ...photos];
    out.push({
      id: r.id, slug: r.slug, status: r.status, version: r.version, url: r.url, publishedAt: r.publishedAt?.toISOString() ?? null,
      expired: r.status === "live" && !!r.publishedAt && r.publishedAt.getTime() < cutoff, withdraw: r.status !== "taken_down" && site(website),
      // (no link to the copies: the page goes up with its own picture addresses rather than broken ones)
      hold: r.hold, html: up ? (assets.length && link ? rewriteAssets(r.html, assets) : r.html) : "",
      pages: up ? (r.pages ?? []).map((pg) => ({ path: pg.path, html: assets.length && link ? rewriteAssets(pg.html, [...assetsForPage(copied), ...photoAssetsForPage(photos)]) : pg.html })) : [],
      assets: link ? await Promise.all(assets.map(async (a) => ({ path: a.path, url: await link!(a.key, a.type) }))) : [],
      photosRev: up ? photosRevOf((r.photos ?? []) as SamplePhoto[], [r.html, ...(r.pages ?? []).map((pg) => pg.html)]) : "",
    });
  }
  return out;
}

const PAGES_URL = /^https:\/\/[a-z0-9-]+\.pages\.dev\/[a-z0-9-]+\/$/;
export type PublishReport = "published" | "unpublished" | "expired" | "withdrawn";

/** The publisher's report: "published" (approved -> live with its address, the lead's Sample site cell filled), "expired"
 *  (live 30 days -> taken down) and "unpublished" (its page is gone: the address cleared here and on the lead). */
/** When the page on the web expires while a newer version waits, the row stays in
 *  review with its requests: only the approved version is let go (nothing approved is left to serve), the address cleared. */
const waitingStays = (s: SampleRow): Partial<typeof samples.$inferInsert> | null =>
  (OPEN as readonly string[]).includes(s.status) ? { approvedVersion: null, url: "", updatedAt: new Date() } : null;

export async function reportPublish(d: Db, tenantId: string, id: string, report: PublishReport, url: string, now = new Date()): Promise<SampleRow> {
  const [s] = await d.select(listCols).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, id)));
  if (!s) throw new SampleError(404, "no such sample");
  let set: Partial<typeof samples.$inferInsert>;
  let leadUrl: string | null = null;
  if (report === "published") {
    if (!PAGES_URL.test(url) || !url.includes(`/${s.slug}/`)) throw new SampleError(400, "url is https://<project>.pages.dev/<the sample's slug>/");
    // a sample whose approved version is served while a newer one waits keeps its status (the newer one waits)
    const serving = (OPEN as readonly string[]).includes(s.status) && s.approvedVersion !== null;
    if (s.status !== "approved" && s.status !== "live" && !serving) throw new SampleError(409, `only an approved sample goes live; this one is ${s.status.replace("_", " ")}`);
    if (s.hold) throw new SampleError(409, "this sample is on hold: a person releases it first");
    set = serving ? { url, publishedAt: s.publishedAt ?? now, updatedAt: now } : { status: "live", url, publishedAt: s.status === "approved" ? now : s.publishedAt, updatedAt: now };
    leadUrl = url;
  } else if (report === "withdrawn") {
    const [l] = await d.select({ website: leads.website }).from(leads).where(eq(leads.id, s.leadId));
    if (s.status === "taken_down" || !(l?.website ?? "").trim()) throw new SampleError(409, "only a sample whose business now has a website is withdrawn");
    // (the waiting-version rule covers expiry only: a business with a website gets no sample, so a waiting draft could never go up)
    set = { status: "taken_down", note: "the business has its own website now", updatedAt: now };
  } else if (report === "expired") {
    const upLong = s.status === "live" || ((OPEN as readonly string[]).includes(s.status) && s.approvedVersion !== null && !!s.url);
    if (!upLong || !s.publishedAt || now.getTime() - s.publishedAt.getTime() < EXPIRE_DAYS * 86400_000) throw new SampleError(409, `only a page live ${EXPIRE_DAYS} days expires`);
    set = waitingStays(s) ?? { status: "taken_down", note: `expired after ${EXPIRE_DAYS} days`, updatedAt: now };
    if (waitingStays(s)) leadUrl = "";
  } else {
    if (s.status !== "taken_down" && !s.hold) throw new SampleError(409, "only a taken-down or held sample comes off the web");
    set = { url: "", updatedAt: now };
    leadUrl = "";
  }
  set.reviewedBy = s.reviewedBy;   // the person's decision stays theirs; the publisher only reports
  const [row] = await d.update(samples).set(set).where(eq(samples.id, id)).returning();
  if (row.status === "taken_down" || (report !== "published" && report !== "unpublished" && row.approvedVersion === null)) await dropReference(d, tenantId, id);
  if (leadUrl !== null) {
    // the lead's Sample site cell is a person's cell: filled from a person's approval, and only while it is empty or still this
    // sample's own address, so a link a person typed there is never replaced
    await d.update(leads).set({ sampleUrl: leadUrl || null, updatedAt: now })
      .where(and(eq(leads.tenantId, tenantId), eq(leads.id, s.leadId), or(isNull(leads.sampleUrl), eq(leads.sampleUrl, ""), eq(leads.sampleUrl, s.url || url))));
    if (leadUrl) await syncLeadSends(d, tenantId, s.leadId); // a first public link puts the lead in the test
  }
  return strip(row);
}

// ---- the Handover bundle ----------------------------------------------------------------------------------------
/** What a person gets to make the final site after a reply: the page, its pictures as files, and facts.md saying where
 *  each thing on the page came from. Pure: the sample row and its lead in, [name, contents] out. */
export function handoverFiles(s: { slug: string; version: number; template: string; copy: Record<string, unknown>; html: string; pages?: { path: string; html: string }[] },
                              l: Row, price: string): [string, Uint8Array | string][] {
  const files: [string, Uint8Array | string][] = [];
  let html = s.html;
  const map = html.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
  if (map) {
    files.push(["assets/map.png", Buffer.from(map[1], "base64")]);
    html = html.replace(map[0], "assets/map.png");
  }
  const art = html.match(/<svg viewBox="0 0 120 120"[\s\S]*?<\/svg>/);
  if (art) files.push(["assets/illustration.svg", art[0].replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ')]);
  files.unshift(["index.html", html]);
  for (const pg of s.pages ?? []) files.push([pg.path, pg.html]); // the extra pages, each in its folder
  const f = listingFacts(l.listingEvidence);
  const fam = familyOf(s.template) ?? "plain";
  const c = s.copy as Record<string, unknown>;
  const line = (label: string, value: unknown, source: string) => `- **${label}:** ${String(value ?? "").trim() || "(empty)"} -- ${source}`;
  const copyLines = typeof c.about === "string"
    ? [line("Headline", c.headline, "Site Builder's text"), line("About", c.about, "Site Builder's text"), line("Button", c.cta, "Site Builder's text")]
    : [line("Headline", c.headline, "Site Builder's text"), line("Intro", c.intro, "Site Builder's text"),
       ...(c.noticed ? [line("Noticed", c.noticed, "Site Builder's text")] : []),
       ...(Array.isArray(c.sections) ? (c.sections as { title?: string; body?: string }[]).map((x, i) => line(`Section ${i + 1}`, `${x.title ?? ""}: ${x.body ?? ""}`, "Site Builder's text")) : []),
       line("Button", c.cta, "Site Builder's text")];
  const md = [
    `# ${l.business.split(" | ")[0].trim()}: sample site, version ${s.version}`,
    "",
    `The sample page as it stands (index.html, its pictures under assets/) and where each part came from. Make the final site from`,
    `this; check every fact with the business first.`,
    "",
    "## From the lead's row",
    line("Business name", l.business.split(" | ")[0], "row: Business"),
    line("Trade", f.kind ?? l.industry, f.kind ? "Google listing (row: Listing evidence)" : "row: Industry"),
    line("Address", l.address, "row: Address (not on the sample page: the area only)"),
    line("Area", areaOf(l), "row: Location (city and state)"),
    line("Phone", l.phone, "row: Phone (not on the sample page: the WhatsApp button)"),
    line("WhatsApp", l.whatsapp, "row: WhatsApp"),
    line("Opening days", f.open, "Google listing (row: Listing evidence)"),
    line("Rating", f.rating && f.reviews ? `${f.rating}★, ${f.reviews} reviews` : "", "Google listing (row: Listing evidence)"),
    line("Google Maps link", l.mapLink, "row: Map link"),
    line("Instagram", l.instagramUrl, "row: Instagram"),
    line("Facebook", l.facebookUrl, "row: Facebook"),
    "",
    "## Written for the page",
    ...copyLines,
    "",
    "## From the template",
    line("Family", fam, "template, picked from the trade"),
    line("Lead section", angleOf(l.painPoint), "template, from the pain point's first line"),
    line("Illustration", "assets/illustration.svg", "template (our own drawing)"),
    line("Area map", map ? "assets/map.png" : "", "OpenStreetMap tile of the city (credit: © OpenStreetMap contributors)"),
    line("Footer price", price || "priced after a short call", "template, from the Rates' Starter Website line"),
    "",
    "## For the team only (not on the page)",
    line("Pain point", (l.painPoint ?? "").replace(/\s*\n\s*/g, " / "), "row: Pain point"),
    "",
  ].join("\n");
  files.push(["facts.md", md]);
  return files;
}

/** The bundle's files for a sample id, or null. */
export async function handoverOf(d: Db, tenantId: string, id: string): Promise<{ slug: string; version: number; files: [string, Uint8Array | string][] } | null> {
  const [r] = await d.select({ s: samples, l: leads }).from(samples).innerJoin(leads, eq(leads.id, samples.leadId)).where(and(eq(samples.tenantId, tenantId), eq(samples.id, id)));
  if (!r) return null;
  return { slug: r.s.slug, version: r.s.version, files: handoverFiles(r.s, r.l, await starterPrice(d, tenantId)) };
}

// ---- the sample's edited photos ---------------------------------------------------------------------------
/** Keep one edited photo for a sample (the helper's upload with the engine's key): checked by lib/sample-photos.ts
 *  (name, magic bytes, 5 MB, 90 files and 30 MB a sample), stored at samples/<id>/photos/<name>, listed on the sample; the same name again
 *  replaces it. Its guest flag and dish say what it is. Answers the sample's photo list. */
/** The photo names the sample's pages in use point at -- the current version (a waiting draft or what is
 *  up) and the approved version when it is an older one. */
async function photosInUse(d: Db, s: { id: string; tenantId: string; version: number; approvedVersion: number | null; html: string; pages: { html: string }[] | null }): Promise<{ current: string[]; approved: string[] }> {
  const current = photoRefs([s.html, ...(s.pages ?? []).map((pg) => pg.html)].join("\n"));
  if (s.approvedVersion === null) return { current, approved: [] };
  if (s.approvedVersion === s.version) return { current, approved: current };
  const [v] = await d.select({ html: sampleVersions.html, pages: sampleVersions.pages }).from(sampleVersions)
    .where(and(eq(sampleVersions.tenantId, s.tenantId), eq(sampleVersions.sampleId, s.id), eq(sampleVersions.version, s.approvedVersion)));
  return { current, approved: v ? photoRefs([v.html, ...(v.pages ?? []).map((pg) => pg.html)].join("\n")) : [] };
}

/** The one change a photo on an approved or live page takes: the same picture, new tone and colour, under
 *  its own name. Always compared with the first original, so small steps cannot walk away from it. No new version; status, page and
 *  requests do not change; the Accept, guest and dish marks stay. The original is kept, once. */
async function replaceGraded(d: Db, tenantId: string, id: string, old: SamplePhoto, name: string, bytes: Uint8Array, meta: { guest?: boolean; dish: string; by: string }, put: Pick<AssetStore, "put">, now: Date): Promise<SamplePhoto[]> {
  const frozen = (why: string) => new SampleError(409, `the approved version shows photos/${name}: upload the new picture under a new name and point the next version at it. Here only the same picture with new tone and colour is taken (${why})`);
  const sentDish = meta.dish.replace(/\s+/g, " ").trim();
  if (sentDish && sentDish !== old.dish) throw frozen("its dish mark cannot change");
  if (meta.guest !== undefined && meta.guest !== old.guest) throw frozen("its guest mark cannot change");
  const st = await storage().catch(() => null);
  const read = (key: string, type: string) => (st ? readPhoto(st, { ...old, key, type }).catch(() => null) : Promise.resolve(null));
  const [reference, current] = await Promise.all([read(old.original?.key ?? old.key, old.original?.type ?? old.type), read(old.key, old.type)]);
  if (!reference || !current) throw frozen("the stored picture could not be read");
  const check = await samePicture(reference, bytes);
  if (!check.same) throw frozen(check.reason);
  const sha = sha256Bytes(bytes);
  if (sha === sha256Bytes(current)) return ((await d.select({ photos: samples.photos }).from(samples).where(eq(samples.id, id)))[0]?.photos ?? []) as SamplePhoto[];
  const original = old.original ?? { key: `samples/${id}/originals/${name}`, bytes: reference.length, type: old.type, at: now.toISOString() };
  if (!old.original) await put.put(original.key, reference, original.type);
  await put.put(old.key, bytes, old.type);
  return d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [cur] = await t.select({ photos: samples.photos, status: samples.status }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, id))).for("update");
    const list = (cur?.photos ?? []) as SamplePhoto[];
    if (!cur || cur.status === "taken_down" || cur.status === "rejected" || list.find((p) => p.name === name)?.at !== old.at) throw new SampleError(409, `photos/${name} changed while this was uploading: nothing was replaced`);
    const photos = list.map((p) => (p.name === name ? { ...p, bytes: bytes.length, at: now.toISOString(), original, graded: { at: now.toISOString(), by: meta.by.slice(0, 80), sha } } : p));
    await t.update(samples).set({ photos }).where(eq(samples.id, id));
    console.log(`peek photo grade ${JSON.stringify({ at: now.toISOString(), sample: id, file: name, by: meta.by.slice(0, 80) })}`);
    return photos;
  }).catch(async (err) => {
    await put.put(old.key, current, old.type).catch(() => undefined); // the row did not take it: the file goes back
    throw err;
  });
}

/** An owner or a manager puts a graded photo's original back, on every file of it. Allowed on a live sample. The Accept and the
 *  marks stay, and the publisher picks the change up by photosRev. */
export async function restorePhotoOriginal(d: Db, tenantId: string, id: string, base: string, now = new Date()): Promise<{ restored: number }> {
  const s = await photoRow(d, tenantId, id);
  const files = s.kept.filter((p) => photoBase(p.name) === base && p.graded && p.original);
  if (!files.length) throw new SampleError(409, "this photo has no grade to undo");
  const st = await storage();
  if (!st) throw new SampleError(503, "file storage is not set up");
  const put = await defaultAssetStore();
  if (!put) throw new SampleError(503, "file storage is not set up");
  const back = await Promise.all(files.map(async (p) => ({ p, bytes: await readPhoto(st, { ...p, key: p.original!.key, type: p.original!.type }) })));
  if (back.some((x) => !x.bytes)) throw new SampleError(503, "the original could not be read: nothing was changed");
  for (const { p, bytes } of back) await put.put(p.key, bytes!, p.original!.type);
  return d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const row = await photoRow(t, tenantId, id);
    const names = new Set(files.map((p) => p.name));
    const photos = row.kept.map((p) => {
      if (!names.has(p.name) || !p.original) return p;
      const { graded: _g, ...rest } = p;
      void _g;
      return { ...rest, bytes: p.original.bytes, type: p.original.type, at: now.toISOString() };
    });
    await t.update(samples).set({ photos }).where(eq(samples.id, id));
    return { restored: files.length };
  });
}

export async function putSamplePhoto(d: Db, tenantId: string, id: string, name: string, bytes: Uint8Array, meta: { guest?: boolean; dish: string; by: string },
  store?: Pick<AssetStore, "put"> | null, now = new Date()): Promise<SamplePhoto[]> {
  const [s] = await d.select({ id: samples.id, tenantId: samples.tenantId, photos: samples.photos, status: samples.status, version: samples.version, approvedVersion: samples.approvedVersion, html: samples.html, pages: samples.pages })
    .from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, id)));
  if (!s) throw new SampleError(404, "no such sample");
  if (s.status === "taken_down" || s.status === "rejected") throw new SampleError(409, `this sample is ${s.status.replace("_", " ")}: reopen it first`);
  const kept = (s.photos ?? []) as SamplePhoto[];
  const problem = uploadProblem(name, bytes, kept);
  if (problem) throw new SampleError(problem.startsWith("this sample keeps") ? 409 : 400, problem);
  const st = store === undefined ? await defaultAssetStore() : store;
  if (!st) throw new SampleError(503, "file storage is not set up, so the photo cannot be kept");
  // a photo the approved version shows is frozen -- a new picture takes a new name, for the next version. The
  // one exception is the same picture with new tone and colour
  const shownNow = kept.find((p) => p.name === name);
  if (shownNow && (await photosInUse(d, s)).approved.includes(name)) return replaceGraded(d, tenantId, id, shownNow, name, bytes, meta, st, now);
  const key = `samples/${id}/photos/${name}`;
  const type = name.endsWith(".webp") ? "image/webp" : name.endsWith(".png") ? "image/png" : "image/jpeg";
  await st.put(key, bytes, type);
  const replacing = kept.some((p) => p.name === name);
  const entry: SamplePhoto = { name, key, type, bytes: bytes.length, guest: meta.guest ?? false, dish: meta.dish.replace(/\s+/g, " ").trim().slice(0, 80), at: now.toISOString(), by: meta.by.slice(0, 80) };
  // read again and write under the row's lock, so an upload beside this one keeps its entry and a sample
  // removed meanwhile (a swept shell) answers 404 instead of a success
  return d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [cur] = await t.select({ photos: samples.photos, status: samples.status }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, id))).for("update");
    if (!cur || cur.status === "taken_down" || cur.status === "rejected") throw new SampleError(cur ? 409 : 404, cur ? `this sample is ${cur.status.replace("_", " ")}: reopen it first` : "no such sample");
    const now0 = (cur.photos ?? []) as SamplePhoto[];
    const again = uploadProblem(name, bytes, now0);
    if (again) throw new SampleError(409, again);
    // a mark is kept when the caller sends none (a replace in place, a new size of the same photo); one sent is the
    // whole photo's, on every file of it
    const base = photoBase(name);
    const had = now0.find((p) => p.name === name) ?? now0.find((p) => photoBase(p.name) === base && (p.dish || p.dishAt));
    const placed = [...now0.filter((p) => p.name !== name), entry.dish || !had ? entry : { ...entry, dish: had.dish, ...(had.dishAt ? { dishAt: had.dishAt } : {}) }];
    const photos = entry.dish ? withDish(placed, base, entry.dish, now.toISOString()) : placed;
    await t.update(samples).set({ photos, updatedAt: now }).where(eq(samples.id, id));
    return photos;
  }).then(async (photos) => {
    // a different picture under this name on a page not approved: the old one's kept original no longer belongs to it
    if (shownNow?.original) await storage().then((x) => x?.remove(shownNow.original!.key)).catch(() => undefined);
    return photos;
  }).catch(async (err) => {
    // refused after the bytes were stored: a new file is removed again (a replacement's key holds the person's photo)
    if (!replacing) await storage().then((x) => x?.remove(key)).catch(() => undefined);
    throw err;
  });
}

/** Drop one photo from a sample (its file too, when storage answers). Refused while the current page still uses it. */
export async function deleteSamplePhoto(d: Db, tenantId: string, id: string, name: string, remove?: ((key: string) => Promise<void>) | null): Promise<SamplePhoto[]> {
  const [s] = await d.select({ id: samples.id, tenantId: samples.tenantId, photos: samples.photos, version: samples.version, approvedVersion: samples.approvedVersion, html: samples.html, pages: samples.pages })
    .from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, id)));
  if (!s) throw new SampleError(404, "no such sample");
  const kept = (s.photos ?? []) as SamplePhoto[];
  const p = kept.find((x) => x.name === name);
  if (!p) throw new SampleError(404, "no such photo on this sample");
  // in use on the current version or on the approved one (which may be older and still on the web)
  const use = await photosInUse(d, s);
  if (use.current.includes(name)) throw new SampleError(409, `the current page uses photos/${name}: post a page without it first`);
  if (use.approved.includes(name)) throw new SampleError(409, `the approved version on the web shows photos/${name}: it stays until a version without it is approved`);
  const rm = remove === undefined ? await storage().then((st) => (st ? (k: string) => st.remove(k) : null)) : remove;
  if (rm) await rm(p.key).catch((err) => console.error("samples.photo remove", p.key, err instanceof Error ? err.message : err));
  if (rm && p.original) await rm(p.original.key).catch((err) => console.error("samples.photo remove", p.original!.key, err instanceof Error ? err.message : err));
  // the list written under the row's lock (an upload beside this delete keeps its entry)
  return d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [cur] = await t.select({ photos: samples.photos }).from(samples).where(eq(samples.id, id)).for("update");
    const photos = ((cur?.photos ?? []) as SamplePhoto[]).filter((x) => x.name !== name);
    await t.update(samples).set({ photos, updatedAt: new Date() }).where(eq(samples.id, id));
    return photos;
  });
}

/** A preview's html with the sample's photos inline: read from the bucket (or the local folder) on the server. */
export async function withPhotos(d: Db, tenantId: string, id: string, html: string): Promise<string> {
  if (!photoRefs(html).length) return html;
  const [s] = await d.select({ photos: samples.photos }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, id)));
  const st = await storage();
  if (!s || !st) return html;
  return inlinePhotos(html, (s.photos ?? []) as SamplePhoto[], (p) => readPhoto(st, p));
}

type PhotoStore = NonNullable<Awaited<ReturnType<typeof storage>>>;
async function readPhoto(st: PhotoStore, p: SamplePhoto): Promise<Uint8Array | null> {
  if (st.kind === "local") return new Uint8Array(await readLocal(p.key));
  const r = await fetch(await st.downloadUrl(p.key, p.name, p.type, true, ""), { signal: AbortSignal.timeout(15000) });
  return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
}

/** One photo on this sample's own list, for the review card; null when it is not there or cannot be read. */
export async function samplePhotoBytes(d: Db, tenantId: string, id: string, name: string): Promise<{ bytes: Uint8Array; type: string; viewKey: string | null } | null> {
  const [s] = await d.select({ photos: samples.photos }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, id)));
  const p = ((s?.photos ?? []) as SamplePhoto[]).find((x) => x.name === name);
  const st = p ? await storage() : null;
  if (!p || !st) return null;
  const bytes = await readPhoto(st, p);
  if (!bytes || sniff(bytes) !== p.type) return null;
  // set only on the photo's largest file, the one Accept needs opened
  const key = photoViewKey(id, p);
  return { bytes, type: p.type, viewKey: fullViewKey((s?.photos ?? []) as SamplePhoto[], id, photoBase(name)) === key ? key : null };
}

/** What a person checked in one photo, on every file of it, under the row's lock so an upload beside it keeps its
 *  entry. It changes no page and names nobody. Answers the ticks kept and how many photos the page still needs checked. */
export async function setPhotoChecks(d: Db, tenantId: string, id: string, base: string, raw: unknown, now = new Date()): Promise<{ checks: PhotoCheck[]; left: number }> {
  const checks = cleanChecks(raw);
  if (!checks) throw new SampleError(400, "checks is a list of people, plates, screens and print");
  return d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [s] = await t.select({ photos: samples.photos, status: samples.status, html: samples.html, pages: samples.pages }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, id))).for("update");
    if (!s || s.status === SHELL) throw new SampleError(404, "no such sample");
    if (s.status === "taken_down" || s.status === "rejected") throw new SampleError(409, `this sample is ${s.status.replace("_", " ")}`);
    const kept = (s.photos ?? []) as SamplePhoto[];
    if (!kept.some((p) => photoBase(p.name) === base)) throw new SampleError(404, "no such photo");
    if (!isChecked(checks) && kept.some((p) => photoBase(p.name) === base && p.rejected)) throw new SampleError(409, "this photo is rejected: accept it or leave it rejected");
    const photos = withChecks(kept, base, checks, now.toISOString());
    await t.update(samples).set({ photos }).where(eq(samples.id, id));
    return { checks, left: photosLeft(reviewPhotos(photos, photoRefs([s.html, ...(s.pages ?? []).map((pg) => pg.html)].join("\n")))) };
  });
}

/** The row under its lock, for a decision on its photos; refused when it takes none. */
async function photoRow(t: Db, tenantId: string, id: string) {
  const [s] = await t.select({ photos: samples.photos, status: samples.status, version: samples.version, html: samples.html, pages: samples.pages }).from(samples).where(and(eq(samples.tenantId, tenantId), eq(samples.id, id))).for("update");
  if (!s || s.status === SHELL) throw new SampleError(404, "no such sample");
  if (s.status === "taken_down" || s.status === "rejected") throw new SampleError(409, `this sample is ${s.status.replace("_", " ")}`);
  return { ...s, kept: (s.photos ?? []) as SamplePhoto[], used: photoRefs([s.html, ...(s.pages ?? []).map((pg) => pg.html)].join("\n")) };
}
const tally = (photos: SamplePhoto[], used: string[]) => {
  const rows = reviewPhotos(photos, used);
  return { left: photosLeft(rows), rejected: photosRejected(rows) };
};

/** Reject on one photo, with the optional "What is wrong?". It changes no page and names nobody. */
export async function rejectPhoto(d: Db, tenantId: string, id: string, base: string, rawNote: unknown, now = new Date()): Promise<{ note: string; left: number; rejected: number }> {
  const note = cleanRejectNote(rawNote);
  return d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const s = await photoRow(t, tenantId, id);
    if (!s.kept.some((p) => photoBase(p.name) === base)) throw new SampleError(404, "no such photo");
    const photos = withRejection(s.kept, base, note, now.toISOString());
    await t.update(samples).set({ photos }).where(eq(samples.id, id));
    return { note, ...tally(photos, s.used) };
  });
}

/** A person says what this photo shows: one of the lead's own items, a name they typed (a custom text
 *  box, so a person can enter a name that is not in the list), or null for "none of these". A typed name is plain text, at most
 *  DISH_MAX characters. On every file of the photo, under the row's lock. It changes no page and is separate from Accept. */
export async function setPhotoDish(d: Db, tenantId: string, id: string, base: string, raw: unknown, now = new Date()): Promise<{ dish: string }> {
  if (raw !== null && typeof raw !== "string") throw new SampleError(400, "dish is a name, or null for none of these");
  const dish = raw === null ? "" : raw.replace(/\s+/g, " ").trim();
  if (dish.length > DISH_MAX) throw new SampleError(400, `a name is at most ${DISH_MAX} characters`);
  if (/[<>\p{Cc}]/u.test(dish)) throw new SampleError(400, "a name is plain text, without < or >");
  return d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const s = await photoRow(t, tenantId, id);
    const files = s.kept.filter((p) => photoBase(p.name) === base);
    if (!files.length) throw new SampleError(404, "no such photo");
    await t.update(samples).set({ photos: withDish(s.kept, base, dish, now.toISOString()) }).where(eq(samples.id, id));
    return { dish };
  });
}

/** "Send back with N rejected photos": the rejected photos and their notes filed as a change request, the way any
 *  request is (a draft goes to changes_requested; an approved or live page stays up and the request waits for its next version).
 *  A draft needs every photo decided first. Each photo is marked with the version that carried it, so it is not filed twice. */
export async function sendBackRejected(d: Db, tenantId: string, id: string, who: { name: string; userId?: string | null }, seen: number, now = new Date()): Promise<{ sent: number; requests: number }> {
  return d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const s = await photoRow(t, tenantId, id);
    if (s.version !== seen) throw newerArrived(s.version, seen);
    const rows = reviewPhotos(s.kept, s.used);
    const left = photosLeft(rows);
    if (s.status === "draft" && left) throw new SampleError(409, `${photoCount(left)} still ${left === 1 ? "needs" : "need"} Accept or Reject. Nothing was sent.`);
    const send = rows.filter((p) => p.rejected && (s.status === "draft" || p.sentOn !== s.version));
    if (!send.length) throw new SampleError(409, "no rejected photo is waiting to be sent");
    await t.update(samples).set({ photos: withRejectSent(s.kept, new Set(send.map((p) => p.base)), s.version), updatedAt: now }).where(eq(samples.id, id));
    const texts = rejectRequests(send);
    for (const text of texts) await recordRequest(t, tenantId, id, { text, byName: who.name, byUser: who.userId ?? null });
    return { sent: send.length, requests: texts.length };
  });
}


/** Per sample, its open change requests and how many of them carry a picture (the engine reads these on the
 *  list and asks for a sample's requests only when it has open ones). */
export async function openRequestCounts(d: Db, tenantId: string, ids: string[]): Promise<Map<string, { open: number; withPictures: number }>> {
  if (!ids.length) return new Map();
  const rows = await d.select({ id: sampleRequests.sampleId, open: sql<number>`count(*)::int`, pics: sql<number>`count(*) filter (where jsonb_array_length(${sampleRequests.pictures}) > 0)::int` })
    .from(sampleRequests).where(and(eq(sampleRequests.tenantId, tenantId), inArray(sampleRequests.sampleId, ids), eq(sampleRequests.status, "open"))).groupBy(sampleRequests.sampleId);
  return new Map(rows.map((r) => [r.id, { open: Number(r.open), withPictures: Number(r.pics) }]));
}

// ---- the Samples review screen (what needs you first) --------------------------------
export type ReviewGroup = "needs" | "builder" | "up" | "done";
export const REVIEW_GROUPS: { key: ReviewGroup; label: string }[] = [
  { key: "needs", label: "Needs you" },
  { key: "builder", label: `With the ${agentName("Site Builder")}` },
  { key: "up", label: "Live and approved" },
  { key: "done", label: "Done" },
];
/** Where a sample sits on the review screen, and why, in one line (pure). A draft needs a person; a sample sent back or
 *  with an open request waits for the Site Builder; an approved or live one with nothing waiting is up; taken down or
 *  rejected is done. */
export function reviewOf(c: SampleCard, publishPolledAt: string | null = null, now = Date.now()): { group: ReviewGroup; why: string } {
  const open = c.requests.filter((r) => r.status === "open");
  const words = (t: string) => { const one = t.replace(/\s+/g, " ").trim(); return one.length > 60 ? `${one.slice(0, 60).replace(/\s+\S*$/, "")}…` : one; };
  if (c.status === "taken_down" || c.status === "rejected") {
    // in the 7 days before its files go, the list says when
    const label = c.status === "rejected" ? "Rejected" : "Taken down";
    const goes = new Date(new Date(c.draftedAt).getTime() + 30 * 86_400_000);
    const soon = !c.url && goes.getTime() - now <= 7 * 86_400_000;
    return { group: "done", why: soon ? `${label} · its photos and pictures are removed ${goes.getTime() <= now ? "on the next clean-up" : `on ${goes.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}; the text stays` : label };
  }
  // an incomplete version stays with the builder and says why
  if ((c.status === "draft" || c.status === "changes_requested") && c.notComplete) return { group: "builder", why: notCompleteLine(c.version, c.notComplete) };
  // a version that leaves a request open never reads as waiting for a person
  if ((c.status === "draft" || c.status === "changes_requested") && open.length) return { group: "builder", why: openRequestsLine(c.version, open.length) };
  if (c.status === "draft") {
    const up = c.approvedVersion !== null && c.approvedVersion !== c.version ? ` (version ${c.approvedVersion} is ${c.url ? "live" : "approved"})` : "";
    const guest = c.guestPhotos.length ? ` · ${c.guestPhotos.length} guest photo${c.guestPhotos.length === 1 ? "" : "s"}` : "";
    return { group: "needs", why: `Version ${c.version} waits for you${up}${guest}` };
  }
  if (c.status === "changes_requested" || open.length) return { group: "builder", why: open.length ? `${open.length} request${open.length === 1 ? "" : "s"} open: ${words(open[0].text)}` : `Sent back: ${words(c.note)}` };
  // what the publisher really does now (it ran within 30 minutes), never a promise. The cases the
  // publish rules keep off the web come first
  const running = !!publishPolledAt && now - new Date(publishPolledAt).getTime() < 30 * 60_000;
  const state = c.status === "live" ? "Live" : "Approved";
  if (c.website) return { group: "up", why: `${state}, but the business has a website now: ${c.url ? "it comes down" : "it is not published"}` };
  if (c.hold) return { group: "up", why: `${state}, on hold: ${c.url ? "it comes off the web" : "it stays off the web"} until someone releases it` };
  if (c.guestWait) return { group: "needs", why: `${state} by Settings, but it shows a guest's photo: it waits for a person's Approve` };
  // an approved page not up yet waits while it shows a rejected photo
  const noPhotos = c.approvedVersion === c.version && !c.url ? photosRejected(c.photoChecks ?? []) : 0;
  if (c.status === "approved" && noPhotos) return { group: "needs", why: `Approved, but ${photoCount(noPhotos)} ${noPhotos === 1 ? "was" : "were"} rejected: it stays off the web until a version without ${noPhotos === 1 ? "it" : "them"} is approved` };
  if (c.status === "live") return { group: "up", why: running ? "Live" : "Live (publishing is paused: changes do not go up)" };
  return { group: "up", why: running ? `Approved: it goes up on the publisher's next run (it last ran ${ranAgo(publishPolledAt, now)})` : "Approved: publishing is paused, so not live yet" };
}


// ---- what a decision does, in words (the Approve message says what will happen) ----------------
/** Record the publisher's visit (GET /v1/samples/publish, every 10 minutes while it runs). */
export async function markPublishPoll(d: Db, tenantId: string, now = new Date()): Promise<void> {
  await d.update(tenants).set({ settings: sql`coalesce(${tenants.settings}, '{}'::jsonb) || ${JSON.stringify({ samplesPublishPolledAt: now.toISOString() })}::jsonb` }).where(eq(tenants.id, tenantId));
}

