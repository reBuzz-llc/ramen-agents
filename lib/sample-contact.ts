// The contact rules Peek shares with the engine (the engine's site_page.contact_problems and
// its shared cases tests/fixtures/sample-contact-cases.json): the business's own phone (text or tel:), street, map link and
// social profiles only in the contact/footer section and only as its row holds them; any other phone, street, map or
// profile link is refused, wherever it is. A wa.me link is the WhatsApp button, never "a phone". The contact section starts
// at the first <footer> not inside a <blockquote> or <figure> (a quote's caption), or the first element whose id or class
// names contact, visit, find, location or footer; with none, there is no contact section (the page's end). Pure.

const CONTACT_START = /<footer\b|<[a-z][a-z0-9]*\b[^>]*\b(?:id|class)\s*=\s*["'][^"']*\b(?:contact|visit|find|location|footer)/gi;
const SOCIAL_HOSTS = ["instagram.com", "facebook.com", "fb.com", "tiktok.com", "x.com", "twitter.com", "youtube.com", "linkedin.com", "threads.net", "pinterest.com"];
const MAP_HOSTS = ["google.com/maps", "maps.google.com", "maps.app.goo.gl", "goo.gl/maps"];
const PHONE_RUN = /(?<![\w/])\+?\d[\d\s().-]{6,}\d(?![\w])/g;
// A sample site's hand-in: "4,574 reviews Absolutely stunning place." read as a street -- a
// count is not a house number: no digit or thousands comma before the number, and a count word right after it stops the match
// A sample's footer: "9 PM 330 Main Ave" read as one street -- a time is not a house number either
const COUNT_WORDS = "(?:am|pm|reviews?|ratings?|photos?|pictures?|videos?|stars?|guests?|people|customers?|diners?|years?|months?|weeks?|days?|hours?|minutes?|mins?|times?|dishes|items?|seats?|tables?|percent|likes?|followers?|orders?|visits?)";
const STREET = new RegExp(`(?<![\\d,.])\\b\\d+(?:-\\d+)?\\s+(?!${COUNT_WORDS}\\b)(?:[a-z0-9]+\\s+){0,3}(?:st|street|ave|avenue|rd|road|blvd|boulevard|pl|place|ln|lane|dr|drive|way|ct|court|pkwy|parkway|hwy|highway)\\b\\.?`, "gi");

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const digits = (v: string) => (v ?? "").replace(/\D/g, "").slice(-10);
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const unescape = (s: string) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e: string) => (ENT[e.toLowerCase()] ?? (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : m)));
/** The words of a page fragment: tags, scripts and styles out, entities decoded. */
const fragText = (part: string) => unescape(part.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).split(/\s+/).filter(Boolean).join(" ");
// As in the engine: a line of its own ends a phone or street. "<p>+12015550100</p><p>330 Main
// Ave</p>" ran the house number into the phone and the phone into the street, and a true footer was refused.
const BLOCK_EDGE = /<\/?(?:address|article|aside|blockquote|br|dd|details|div|dl|dt|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|option|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;
/** What the pattern reads in a fragment, never across a block or a line break. Inside one line, a match over inline tags stays
 *  one match (a number styled in two spans is one number) unless it is not the business's and one of its tagged pieces is: then
 *  each piece is read alone, so the true phone beside the true street passes and an invented one beside either is still found. */
function contactFound(pattern: RegExp, part: string, own: (x: string) => boolean): string[] {
  const found: string[] = [];
  for (const block of part.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").split(BLOCK_EDGE)) {
    const pieces = block.split(/<[^>]+>/).map((x) => unescape(x).split(/\s+/).filter(Boolean).join(" ")).filter(Boolean);
    const text = pieces.join(" ");
    let at = 0;
    const spans = pieces.map((t) => {
      const span = { from: at, to: at + t.length, t };
      at += t.length + 1;
      return span;
    });
    for (const m of text.matchAll(pattern)) {
      const start = m.index ?? 0;
      const inside = spans.filter((s) => s.from < start + m[0].length && s.to > start).map((s) => s.t);
      if (inside.length < 2 || own(m[0])) {
        found.push(m[0]);
        continue;
      }
      const alone = inside.flatMap((t) => t.match(pattern) ?? []);
      found.push(...(alone.some(own) ? alone : [m[0]]));
    }
  }
  return found;
}

/** A link compared after normalising: no scheme, no www. or m., no query or fragment, no end slash. */
export const linkKey = (u: string) => (u ?? "").trim().replace(/^https?:\/\/(www\.|m\.)?/i, "").split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();

/** Where the contact/footer section starts (the page's length when there is none). */
export function contactStart(page: string): number {
  for (const m of page.matchAll(CONTACT_START)) {
    const before = page.slice(0, m.index).toLowerCase();
    const inside = ["blockquote", "figure"].reduce((n, t) => n + (before.split(`<${t}`).length - 1) - (before.split(`</${t}`).length - 1), 0);
    if (!(m[0].toLowerCase().startsWith("<footer") && inside > 0)) return m.index ?? page.length;
  }
  return page.length;
}

/** headerCall (the engine's header_call): one tel: button in the <header> is allowed
 *  when the facts hold the business's own phone and WhatsApp is not confirmed -- the link only; the number as text stays in
 *  the contact section. */
export type Contact = { phone?: string | string[]; street?: string | string[]; maps?: string[]; socials?: string[]; headerCall?: boolean; phoneWhere?: string };

// The rule agreed with the Validator, its only writer: `site_facts.phone_checked` holds a copy of
// `site_facts.phone`, written once someone checked that number against the listing or the printed card. Compared by digits, at
// least 7, so a later edit to the phone drops the check by itself. The row's Phone cell is never changed by this.
/** The facts' phone when it is checked, else "". */
export function checkedFactsPhone(facts: unknown): string {
  if (!facts || typeof facts !== "object") return "";
  const { phone, phone_checked: checked } = facts as { phone?: unknown; phone_checked?: unknown };
  if (typeof phone !== "string" || typeof checked !== "string") return "";
  const d = digits(phone);
  return d.length >= 7 && d === digits(checked) ? phone.trim() : "";
}

/** The phones a sample page may show: a checked facts phone (and the row's only if it is the same number written another way),
 *  else the row's. */
export function pagePhones(row: string | null | undefined, facts: unknown): string[] {
  const own = (row ?? "").trim();
  const checked = checkedFactsPhone(facts);
  if (!checked) return own ? [own] : [];
  return own && digits(own) === digits(checked) ? [checked, own] : [checked];
}

/** The facts' phone when the row holds a different number, for the one line on the lead that a person settles; else "". */
export function phoneDiffers(row: string | null | undefined, facts: unknown): string {
  const phone = facts && typeof facts === "object" ? (facts as { phone?: unknown }).phone : "";
  if (typeof phone !== "string") return "";
  const f = digits(phone), r = digits(row ?? "");
  return f.length >= 7 && r.length >= 7 && f !== r ? phone.trim() : "";
}

/** Every contact problem on the page, each a sentence; [] = fine. */
export function contactProblems(page: string, c: Contact): string[] {
  const out: string[] = [];
  const cut = contactStart(page);
  let body = page.slice(0, cut);
  const contact = page.slice(cut);
  const phones = new Set([c.phone ?? []].flat().map(digits).filter((d) => d.length >= 7));
  const notOurs = `the page shows a phone number that is not the business's (only the one ${c.phoneWhere ?? "on its row"})`;
  if (c.headerCall) {
    const hdr = /<header\b[\s\S]*?<\/header>/i.exec(body);
    if (hdr) {
      const tels = [...hdr[0].matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)];
      if (tels.length === 1 && phones.has(digits(tels[0][1]))) {
        const a = hdr.index + (tels[0].index ?? 0);
        body = body.slice(0, a) + 'href="#call"' + body.slice(a + tels[0][0].length);
      }
    }
  }
  const streets = [c.street ?? []].flat().filter((x) => (x ?? "").trim().length > 4).map(norm);
  const nums = (part: string) => {
    const p = part.replace(/https?:\/\/wa\.me\/\d+/gi, "");
    const found = [...contactFound(PHONE_RUN, p, (x) => phones.has(digits(x))).map(digits), ...[...p.matchAll(/href\s*=\s*["']tel:([^"']+)/gi)].map((m) => digits(m[1]))];
    return new Set(found.filter((d) => d.length >= 7));
  };
  for (const d of [...nums(body)].sort())
    out.push(phones.has(d) ? "the page shows a phone number outside the contact/footer section" : notOurs);
  for (const d of [...nums(contact)].sort()) if (!phones.has(d)) out.push(notOurs);
  const btext = norm(fragText(body));
  for (const s of streets) if (btext.includes(s)) out.push("the page shows the street address outside the contact/footer section");
  const ownStreet = (x: string) => streets.some((s) => norm(x).includes(s) || s.includes(norm(x)));
  for (const found of new Set(contactFound(STREET, page, ownStreet).map(norm))) {
    if (!streets.some((s) => found.includes(s) || s.includes(found))) {
      out.push("the page shows a street that is not the business's (only the address on its row or in its facts)");
      break;
    }
  }
  const maps = new Set((c.maps ?? []).filter(Boolean).map(linkKey));
  const socials = new Set((c.socials ?? []).filter(Boolean).map(linkKey));
  const socialRe = new RegExp(`^(?:[a-z0-9-]+\\.)*(${SOCIAL_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|")})(/|$)`);
  for (const [, h] of page.matchAll(/href\s*=\s*["']([^"']+)/gi)) {
    const k = linkKey(h);
    if (MAP_HOSTS.some((x) => k.startsWith(x) || k.includes(x)) && ![...maps].some((a) => k === a || k.startsWith(a) || a.startsWith(k))) out.push(`a map link that is not the business's own (${h.slice(0, 60)}): only the one on its row`);
    else if (socialRe.test(k) && !socials.has(k)) out.push(`a social link that is not the business's own (${h.slice(0, 60)}): only a profile on its row`);
  }
  return [...new Set(out)];
}
