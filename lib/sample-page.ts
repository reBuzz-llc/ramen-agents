// The Site Builder's own page (the template drafts were too basic, so it replaced them): the
// agent writes the whole one-page HTML from the Enricher's site facts, and Peek keeps it as it is -- after these checks, so a
// page never carries what the page rule keeps off it (the street, a phone, an email, a person's name) and never runs or
// loads more than a menu and its pictures and fonts need. Pure: the checks, the noindex line, and the CSP the page is
// served with (its one inline script allowed by its hash, its picture hosts, Google Fonts).
import { createHash } from "node:crypto";
import { ownPhoto } from "./sample-photos";
import { checkedFactsPhone, contactProblems, pagePhones } from "./sample-contact";
import { motionProblems } from "./sample-motion";
import RULE_FILE from "./sample-page-rules.json";

// the safety rules come from the engine's one file (src/ramen/data/sample-page-rules.json, copied here as
// lib/sample-page-rules.json; tests/sample-page-rules.test.ts fails when the copy's hash differs from the engine's)
export const RULES = RULE_FILE.rules;
export const PAGE_MAX = RULES.page_max_bytes;
const BANNED_TAG = new RegExp(`<(${RULES.banned_tags.join("|")})\\b`, "i");
const BANNED_SCHEME = new RegExp(`\\b(?:href|src|action)\\s*=\\s*["']?\\s*(${RULES.banned_link_schemes.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "i");
const MENU_BANNED = new RegExp(`\\b(${RULES.menu_script_banned.join("|")})`);
/** Where a page's pictures may come from besides data: (the listing, Instagram and Facebook photo hosts: only photos the business posted itself; no Yelp), plus each host
 *  the draft's sources name. */
export const PHOTO_HOSTS = [/(^|\.)googleusercontent\.com$/, /(^|\.)ggpht\.com$/, /(^|\.)cdninstagram\.com$/, /(^|\.)fbcdn\.net$/];
const FONT_CSS = "fonts.googleapis.com";
const FONT_FILES = "fonts.gstatic.com";
export const DISCLOSURE = "Not the business's official site";
export const TAKEDOWN_LINE = "reply to the message we sent you";

export type Source = { fact: string; from: string };
export type PageLead = { address?: string | null; location?: string | null; phone?: string | null; businessEmail?: string | null; contactPerson?: string | null;
  /** the site facts the open-now badge's hours and the quotes' reviewers are checked against */
  siteFacts?: unknown;
  /** the business's own map link and profiles, allowed in the contact/footer section */
  mapLink?: string | null; instagramUrl?: string | null; facebookUrl?: string | null; business?: string | null;
  /** a header call button only while WhatsApp is not confirmed; confirmed means a number on the row too */
  whatsappStatus?: string | null; whatsapp?: string | null };

/** The engine's rule: every WhatsApp link form is a WhatsApp button -- wa.me over http or https,
 *  api.whatsapp.com or web.whatsapp.com /send, whatsapp://send, and wa.link. */
export const WA_LINK = /(?:https?:\/\/)?(?:wa\.me\/\+?\d+|(?:api|web|www)\.whatsapp\.com\/send\S*|whatsapp\.com\/send\S*|whatsapp:\/\/send\S*|wa\.link\/\S+)/i; // the engine's, src/ramen/site_page.py
const CJK = /[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]+/g;
/** Every string a fact holds, one text (the words a page may print in another script). */
const factsText = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.map(factsText).join(" ") : v && typeof v === "object" ? Object.values(v).map(factsText).join(" ") : "");

// As the engine's site_page.html_problems (the shared cases: the engine's
// tests/fixtures/sample-feature-cases.json): a second inline script, the open-now badge, may read only the clock and the
// page's own hours data (one data-hours attribute, every time in it one the facts' hours print); no network, no storage,
// nothing written as HTML, at most 1,500 characters. A review is quoted without its reviewer's name.
const OPEN_SCRIPT_MAX = RULES.open_script_max;
const BAD_OPEN = new RegExp(`\\b(${RULES.open_script_banned.join("|")})\\b`);
/** The engine's own review slider, a fixed script, allowed by its exact text (the sha256 of its
 *  body, UTF-8, in the shared rules' engine_slider_script_sha256): a third inline script, at most one. The
 *  version before it stays allowed too (engine_slider_script_sha256_previous), since live pages still carry it. */
const SLIDER_HASHES = new Set([RULES.engine_slider_script_sha256, RULES.engine_slider_script_sha256_previous].filter((h) => typeof h === "string" && h.length === 64));
export const isSliderScript = (body: string) => SLIDER_HASHES.has(createHash("sha256").update(body, "utf8").digest("hex"));
export const isOpenScript = (body: string) => /\b(Date|Intl\.DateTimeFormat)\b/.test(body) && /data-hours|dataset\.hours/.test(body);
/** Every time of day a text names, as minutes after midnight (12AM, midnight and 24:00 as 0; noon 720). */
export function clockMinutes(text: string): Set<number> {
  const out = new Set<number>();
  const low = text.toLowerCase();
  for (const [, h, m, ap] of low.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/g)) out.add((((Number(h) % 12) + (ap.startsWith("p") ? 12 : 0)) * 60 + Number(m ?? 0)) % 1440);
  for (const [, h, m] of low.matchAll(/\b(\d{1,2}):(\d{2})\b(?!\s*(?:am|pm|a\.m|p\.m))/g)) if (Number(h) <= 24) out.add((Number(h) * 60 + Number(m)) % 1440);
  if (low.includes("midnight")) out.add(0);
  if (low.includes("noon")) out.add(720);
  return out;
}
function openNowProblem(html: string, hours: string): string | null {
  const vals = [...html.matchAll(/\sdata-hours\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => m[1] ?? m[2] ?? "");
  if (vals.length !== 1) return "the open-now script needs its hours in exactly one data-hours attribute (on the hours table)";
  if (vals[0].length > 400) return "the data-hours value is over 400 characters: the days and times only";
  if (!hours.trim()) return "an open-now badge needs the facts' hours: leave the badge out";
  const have = clockMinutes(hours);
  const extra = [...clockMinutes(vals[0].replace(/&quot;/g, '"'))].filter((m) => !have.has(m)).sort((a, b) => a - b);
  if (extra.length) return `data-hours has times the facts' hours do not print (${extra.slice(0, 4).map((m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`).join(", ")}): use only the facts' hours`;
  return null;
}
/** The street lines a lead may show in its contact section (a house number first): its address cell, else its saved facts'
 *  address (the engine's `address or sf.address`), and its location cell. */
export function streetsOf(l: PageLead): string[] {
  const facts = l.siteFacts && typeof l.siteFacts === "object" ? (l.siteFacts as { address?: unknown }).address : "";
  const address = (l.address ?? "").trim() || (typeof facts === "string" ? facts : "");
  return [...new Set([address, l.location].flatMap((v) => (v ?? "").split(",").map((p) => p.trim())).filter((p) => p.length >= 6 && /^\d/.test(p)))];
}

/** Pure: the draft's sources, cleaned: up to 40 {fact, from} with an http(s) from. */
export function cleanSources(raw: unknown): Source[] {
  if (!Array.isArray(raw)) return [];
  const out: Source[] = [];
  for (const r of raw.slice(0, 40)) {
    const o = r as { fact?: unknown; from?: unknown };
    const fact = typeof o?.fact === "string" ? o.fact.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    const from = typeof o?.from === "string" ? o.from.trim().slice(0, 500) : "";
    if (fact && /^https?:\/\/[^\s"'<>]+$/.test(from)) out.push({ fact, from });
  }
  return out;
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
};
// ---- the reviewers (the engine's site_page.reviewer_problems, ported line for line) -------------------------------------
const W = "[\\p{L}\\p{N}_]";
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normWords = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", "#39": "'" };
const unescapeHtml = (s: string) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e: string) => ENTITY[e.toLowerCase()] ?? (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : m));
/** site_page.visible_text: script, style and head out, the footer out, tags out, entities decoded, spaces collapsed. */
export const visibleText = (page: string) =>
  unescapeHtml(page.replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Every reviewer problem on the page ([] = fine): a full last name; a short name or second line away from its quote's card
 *  (not within 1,500 characters of it); an image inside a review card that is not the review's own photo. */
export function reviewerProblems(page: string, sf: { quotes?: unknown; photos?: unknown; popular?: unknown }): string[] {
  const out: string[] = [];
  const quotes = (Array.isArray(sf.quotes) ? sf.quotes : []).filter((q): q is Record<string, unknown> => !!q && typeof q === "object");
  const photos = new Set([
    ...quotes.flatMap((q) => (Array.isArray(q.photos) ? q.photos : []).map(String)),
    ...(Array.isArray(sf.photos) ? sf.photos : []).filter((p): p is Record<string, unknown> => !!p && typeof p === "object").map((p) => String(p.url)),
  ]);
  const text = page || "";
  const near = (at: number, len: number) => normWords(visibleText(text.slice(Math.max(0, at - 1500), at + len + 1500)));
  // a reviewer's short name may also stand on a dish card, when a stored recommended_by names that
  // reviewer for that dish and her own words or the listing's recommended-dishes line stand within 600 characters
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const recs = (Array.isArray(sf.popular) ? sf.popular : []).filter((p): p is Record<string, unknown> => isObj(p) && isObj(p.recommended_by)).map((p) => {
    const r = p.recommended_by as Record<string, unknown>;
    return { dish: String(p.name ?? ""), printed: String(r.printed ?? ""), line: String(r.line ?? ""), who: String(r.short_name ?? "").trim() };
  });
  // a reviewer's quotes grouped by her short name (the start of each, as the name check reads it)
  const words = new Map<string, string[]>();
  for (const q of quotes) {
    const k = String(q.first_name ?? "").trim();
    words.set(k, [...(words.get(k) ?? []), normWords(String(q.text ?? "")).slice(0, 40)]);
  }
  const anyOfHers = (name: string, around: string) => (words.get(name) ?? []).some((w) => w && around.includes(w));
  const onItsDish = (name: string, at: number, len: number) => {
    const around = normWords(visibleText(text.slice(Math.max(0, at - 600), at + len + 600)));
    return recs.some((r) => r.who === name && [r.dish, r.printed].some((d) => d && around.includes(normWords(d))) && (anyOfHers(name, around) || (!!r.line && around.includes(normWords(r.line)))));
  };
  for (const name of new Set(recs.map((r) => r.who).filter((w) => w.length >= 2 && !words.has(w)))) // a recommender with no quote of her own
    for (const m of text.matchAll(new RegExp(reEscape(name), "g")))
      if (!onItsDish(name, m.index ?? 0, m[0].length)) {
        out.push(`the page names a reviewer (${name}) on a dish card without her recommendation beside it: show the name only with her own words or the listing's recommended-dishes line, on the dish she recommended`);
        break;
      }
  for (const q of quotes) {
    const name = String(q.first_name ?? "").trim();
    if (name.length < 2 || name.toLowerCase() === "a guest") continue;
    const first = name.split(" ")[0];
    if (new RegExp(`(?<!${W})${reEscape(first)}[ \u00a0]+[A-Z][a-z]{2,}(?!${W})`, "u").test(text) && !new RegExp(`(?<!${W})${reEscape(first)}[ \u00a0]+[A-Z]\\.`, "u").test(text)) {
      out.push(`the page names a reviewer with a full last name (${first} ...); only the short name, ${name}`);
      break;
    }
    const qt = normWords(String(q.text ?? "")).slice(0, 40);
    const second = String(q.second ?? "").trim();
    if (second)
      for (const m of text.matchAll(new RegExp(reEscape(second), "g"))) {
        const around = near(m.index ?? 0, m[0].length);
        if (qt && !around.includes(qt) && !anyOfHers(name, around)) {
          out.push(`the page names a reviewer's line (${second}) away from its quote; show it only beside that review`);
          break;
        }
      }
    for (const m of text.matchAll(new RegExp(reEscape(name), "g"))) {
      const around = near(m.index ?? 0, m[0].length);
      if (qt && !around.includes(qt) && !anyOfHers(name, around) && !onItsDish(name, m.index ?? 0, m[0].length)) {
        out.push(`the page names a reviewer (${name}) away from its quote; show the name only beside that review, or on the dish a stored recommendation names her for, with her words or the recommended-dishes line`);
        break;
      }
    }
  }
  // the card runs to its own closing tag (the engine's 3f1718a), so a picture in a figcaption after the quote is read too
  for (const card of text.matchAll(/<(blockquote|figure|li|article)\b[^>]*(?:data-slide|review|testimonial|quote)[^>]*>([\s\S]*?)<\/\1>/gi))
    for (const u of card[2].matchAll(/<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)/gi))
      if (!photos.has(u[1])) {
        out.push("an image inside a review card that is not the review's own photo: draw the reviewer as a circle with the initial, never a picture");
        return out;
      }
  return out;
}

/** The page's visible text (tags and comments out, entities as their letters), for the personal-data checks. */
const textOf = (html: string) =>
  html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

/** Every picture address the page uses: img src and srcset, source srcset, CSS url(), and the icon links. */
export function imageUrls(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\b(?:src|poster)\s*=\s*["']([^"']*)["']/gi)) out.push(m[1]);
  for (const m of html.matchAll(/\bsrcset\s*=\s*["']([^"']*)["']/gi)) for (const part of m[1].split(",")) out.push(part.trim().split(/\s+/)[0]);
  for (const m of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) out.push(m[1].trim());
  return out.filter(Boolean);
}

/** Pure: the page as Peek keeps it (noindex added when missing), the picture hosts it uses, or why it is refused. */
export function checkPage(raw: unknown, lead: PageLead, sources: Source[] = [], photos: { names: string[]; extra?: boolean } = { names: [] }):
  { ok: true; html: string; hosts: string[] } | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "html is the whole page as one string" };
  let html = raw.trim();
  if (Buffer.byteLength(html) > PAGE_MAX) return { ok: false, error: `the page is ${Math.round(Buffer.byteLength(html) / 1024)} KB: at most ${Math.round(PAGE_MAX / 1024)} KB` };
  if (!/<html[\s>]/i.test(html) || !/<body[\s>]/i.test(html)) return { ok: false, error: "send a whole document: <!doctype html><html>…<body>…</body></html>" };
  const bad = html.match(BANNED_TAG);
  if (bad) return { ok: false, error: `the page may not use <${bad[1].toLowerCase()}>` };
  const handler = html.match(/<[^>]+\s(on[a-z]+)\s*=/i);
  if (handler) return { ok: false, error: `no ${handler[1]}="…" attributes: the menu's one script uses addEventListener` };
  const scheme = html.match(BANNED_SCHEME);
  if (scheme) return { ok: false, error: `no ${scheme[1].toLowerCase()} links` };
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const sliders = scripts.filter(([, , body]) => isSliderScript(body));
  const opens = scripts.filter(([, , body]) => !isSliderScript(body) && isOpenScript(body));
  const menus = scripts.length - opens.length - sliders.length;
  if (scripts.length > 3 || menus > 1 || opens.length > 1 || sliders.length > 1)
    return { ok: false, error: `the page has ${scripts.length} scripts: at most three inline, the menu toggle, the open-now badge and the engine's review slider, one of each` };
  if ((html.match(/<script\b/gi) ?? []).length !== scripts.length) return { ok: false, error: "every <script> is closed with </script>" };
  const sf = (lead.siteFacts && typeof lead.siteFacts === "object" ? lead.siteFacts : {}) as { hours?: unknown; quotes?: unknown; name?: unknown };
  for (const [, attrs, body] of scripts) {
    if (/\bsrc\s*=/i.test(attrs)) return { ok: false, error: "no <script src>: the scripts are inline" };
    if (isSliderScript(body)) continue; // the engine's fixed text, nothing else to check
    if (isOpenScript(body)) {
      if (body.length > OPEN_SCRIPT_MAX) return { ok: false, error: `the open-now script is ${body.length} characters: at most ${OPEN_SCRIPT_MAX}` };
      const bad = BAD_OPEN.exec(body);
      if (bad) return { ok: false, error: `the open-now script may only read the clock and data-hours and set the badge's text (no ${bad[1]})` };
      const hp = openNowProblem(html, typeof sf.hours === "string" ? sf.hours : "");
      if (hp) return { ok: false, error: hp };
      continue;
    }
    if (!RULES.script_module_allowed && /\btype\s*=\s*["']?module/i.test(attrs)) return { ok: false, error: "the menu's script is a plain script, not a module" };
    if (body.length > RULES.menu_script_max) return { ok: false, error: `the menu's script is over ${RULES.menu_script_max.toLocaleString("en-US")} characters` };
    const api = body.match(MENU_BANNED);
    if (api) return { ok: false, error: `the menu's script may not use ${api[0].replace(/\s*\($/, "")}` };
  }
  // stylesheets and fonts: Google Fonts only; nothing else is linked
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const href = m[0].match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    const rel = (m[0].match(/\brel\s*=\s*["']([^"']*)["']/i)?.[1] ?? "").toLowerCase();
    const h = hostOf(href);
    if (/icon/.test(rel) && href.startsWith("data:")) continue;
    if (h !== FONT_CSS && h !== FONT_FILES) return { ok: false, error: `the page may link only Google Fonts, not ${href.slice(0, 80) || rel}` };
  }
  for (const m of html.matchAll(/@import\s+(?:url\()?\s*["']?([^"');\s]+)/gi)) if (hostOf(m[1]) !== FONT_CSS) return { ok: false, error: `@import only from ${FONT_CSS}` };
  // pictures: data: or https on a photo host, or a host the sources name
  const named = new Set(sources.map((s) => hostOf(s.from)).filter(Boolean));
  const hosts = new Set<string>();
  for (const u of imageUrls(html)) {
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif)[;,]/i.test(u)) continue;
    if (u.startsWith("#")) continue; // an SVG reference inside the page
    // the sample's own edited photos, only when uploaded for it (PUT /v1/samples/<id>/photos/<name>)
    if (ownPhoto(u, photos.names, !!photos.extra)) continue;
    if (/^(?:\.\.\/)?photos\//.test(u)) return { ok: false, error: `${u.slice(0, 100)} is not one of this sample's photos: upload it first (PUT /v1/samples/<id>/photos/<name>)` };
    const h = hostOf(u);
    const fontFile = h === FONT_FILES;
    if (!/^https:\/\//i.test(u) || !h || !(fontFile || PHOTO_HOSTS.some((r) => r.test(h)) || named.has(h))) return { ok: false, error: `a picture from ${u.slice(0, 100)}: pictures are data: or https from the listing's photo hosts or a source the draft names` };
    if (!fontFile) hosts.add(h);
  }
  // the page rule: never the street, a phone, an email or a person's name
  const text = textOf(html);
  // the business's own phone, street, map and profiles only in the contact/footer section (lib/sample-contact.ts)
  // one tel: button in the header when the business's own phone is known and WhatsApp is not confirmed (the engine's
  // wa_ok: "verified" in the row's WhatsApp status)
  // "verified" and not "false" (the engine's wa_ok)
  const waOk = /verified/i.test(lead.whatsappStatus ?? "") && !/false/i.test(lead.whatsappStatus ?? "");
  const phones = pagePhones(lead.phone, lead.siteFacts); // a checked facts phone, else the row's
  const headerCall = phones.length > 0 && !waOk;
  // As the engine's html_problems: a wa.me button only for a WhatsApp the team verified; an
  // unverified or false number gets none (Reserve, Call and Directions carry the page). The main page of a verified number
  // has one. Checked on new drafts and hand-ins only: a page already approved is never refused or changed by it.
  const hasWa = WA_LINK.test(html);
  // a button is demanded only when the row has a WhatsApp number (verified with none there demands none)
  const wa = waOk && !hasWa && !photos.extra && !!(lead.whatsapp ?? "").trim() ? "no WhatsApp call: one clear wa.me button (its WhatsApp is verified)"
    : !waOk && hasWa ? "a WhatsApp button for a number the team has not verified: leave it out; Reserve, Call and Directions carry the page" : "";
  const cp = contactProblems(html, { phone: phones, phoneWhere: checkedFactsPhone(lead.siteFacts) ? "checked in its site facts" : undefined, street: streetsOf(lead), maps: [lead.mapLink ?? ""], socials: [lead.instagramUrl ?? "", lead.facebookUrl ?? ""], headerCall });
  // the contact and WhatsApp reasons together, as the engine lists every reason at once
  if (cp.length || wa) return { ok: false, error: [cp[0], wa].filter(Boolean).join("; ") };
  // words in another script (a name like 쌈통, menu names) only as the facts or the row's map link print them
  let map = "";
  try {
    map = decodeURIComponent((lead.mapLink ?? "").replace(/\+/g, " "));
  } catch {
    map = lead.mapLink ?? "";
  }
  const native = `${factsText(lead.siteFacts)} ${lead.business ?? ""} ${map}`;
  const odd = [...new Set(text.match(CJK) ?? [])].filter((w) => !native.includes(w));
  if (odd.length) return { ok: false, error: `words not in the facts: ${odd.slice(0, 6).join(", ")}: a name in its own script only as the facts print it` };
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text) || /mailto:/i.test(html)) return { ok: false, error: "the page shows an email address" };
  const person = (lead.contactPerson ?? "").trim().split(/\s+/)[0] ?? "";
  if (person.length >= 3 && new RegExp(`\\b${person.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) return { ok: false, error: `the page names a person (${person})` };
  // As the engine's reviewer_problems: a review card may show its reviewer's short name ("Kim P.")
  // and second line ("Local Guide · 70 reviews") beside that quote and nowhere else; never a full last name, never a picture
  const rp = reviewerProblems(html, sf);
  if (rp.length) return { ok: false, error: rp[0] };
  // the engine's two motion refusals (lib/sample-motion.ts)
  const mp = motionProblems(html);
  if (mp.length) return { ok: false, error: mp[0] };
  // the footer note is the engine's setting, "none" by default: no disclosure line is required
  if (!/<meta\s+name=["']robots["'][^>]*noindex/i.test(html)) html = html.replace(/<head(\s[^>]*)?>/i, (h) => `${h}<meta name="robots" content="noindex">`);
  if (!/<meta\s+name=["']robots["'][^>]*noindex/i.test(html)) return { ok: false, error: "the page needs a <head>" };
  return { ok: true, html, hosts: [...hosts].sort() };
}

/** Pure: the CSP a stored page is served with in Peek's preview. A builder page: its one inline script by hash, its picture
 *  hosts, Google Fonts, nothing to connect to; a template page as before (no script, data: pictures). Both sandboxed (an
 *  opaque origin: the page never reads Peek's cookies) and allowed to open its links in new tabs. */
export function pageCsp(html: string, kind: string): string {
  const sandbox = "sandbox allow-popups allow-popups-to-escape-sandbox";
  if (kind !== "page") return `default-src 'none'; style-src 'unsafe-inline'; img-src data:; ${sandbox}`;
  const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => `'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
  const hosts = new Set<string>();
  for (const u of imageUrls(html)) {
    const h = /^https:\/\//i.test(u) ? hostOf(u) : "";
    if (h && h !== FONT_FILES) hosts.add(`https://${h}`);
  }
  return [
    "default-src 'none'",
    `script-src ${hashes.length ? hashes.join(" ") : "'none'"}`,
    `style-src 'unsafe-inline' https://${FONT_CSS}`,
    `font-src https://${FONT_FILES} data:`,
    `img-src data: ${[...hosts].sort().join(" ")}`.trim(),
    "connect-src 'none'", "form-action 'none'", "base-uri 'none'", "frame-ancestors 'self'",
    `${sandbox} allow-scripts`,
  ].join("; ");
}

// ---- the pictures at Approve (listing and Instagram photo links expire) ------------
export const ASSET_MAX = 5 * 1024 * 1024;
export const ASSETS_PER_PAGE = 40;
export type Asset = { src: string; path: string; key: string; type: string; /** its size, for the storage line */ bytes?: number;
  /** when it was copied, which is when its version was approved */ at?: string };
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/svg+xml": "svg" };
export const extOf = (type: string) => EXT[type.split(";")[0].trim().toLowerCase()] ?? "";

/** Pure: the outside pictures a page loads (each once, as written in the html), in order. */
export function outsideImages(html: string): string[] {
  return [...new Set(imageUrls(html).filter((u) => /^https:\/\//i.test(u) && hostOf(u.replace(/&amp;/g, "&")) !== FONT_FILES))];
}

/** Pure: the page with each copied picture's address swapped for its file next to index.html (assets/1.jpg ...). */
export function rewriteAssets(html: string, assets: Asset[]): string {
  let out = html;
  for (const a of [...assets].sort((x, y) => y.src.length - x.src.length)) out = out.split(a.src).join(a.path);
  return out;
}

/** Each outside picture fetched once and kept under `prefix` with `put`: https only, from a photo host or a host the sources
 *  name, an image type, at most 5 MB, at most 40. Throws with the reason a person reads (the page is then sent back). */
export async function copyImages(html: string, sources: Source[], prefix: string, put: (key: string, bytes: Uint8Array, type: string) => Promise<void>,
  get: typeof fetch = fetch): Promise<Asset[]> {
  const urls = outsideImages(html);
  if (urls.length > ASSETS_PER_PAGE) throw new Error(`the page loads ${urls.length} outside pictures: at most ${ASSETS_PER_PAGE}`);
  const named = new Set(sources.map((s) => hostOf(s.from)).filter(Boolean));
  const out: Asset[] = [];
  for (const [i, src] of urls.entries()) {
    const url = src.replace(/&amp;/g, "&");
    const h = hostOf(url);
    if (!(PHOTO_HOSTS.some((r) => r.test(h)) || named.has(h))) throw new Error(`a picture from ${h}, not a photo host`);
    let r: Response;
    try {
      r = await get(url, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { "user-agent": "ProductivePeek-SampleSites/1.0" } });
    } catch {
      throw new Error(`picture ${i + 1} (${h}) did not answer: send the page back for a fresh photo link`);
    }
    const type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const ext = extOf(type);
    if (!r.ok || !ext) throw new Error(`picture ${i + 1} (${h}) answered ${r.ok ? type || "no type" : r.status}: send the page back for a fresh photo link`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!bytes.length || bytes.length > ASSET_MAX) throw new Error(`picture ${i + 1} is ${Math.round(bytes.length / 1024)} KB: at most 5 MB`);
    const name = `${i + 1}.${ext}`;
    const key = `${prefix}/${name}`;
    await put(key, bytes, type);
    out.push({ src, path: `assets/${name}`, key, type, bytes: bytes.length });
  }
  return out;
}
