// The public office: the agents' world, read-only, for the team on the portal's Office page. A small server on 127.0.0.1:3200 (scripts/world-public.ts) answers three routes, reached through the
// owner's `tailscale funnel`; this file is its rules, pure so the tests and the dashboard share them:
// - masking: no email addresses, phone numbers or web addresses anywhere; a lead's business reduced to its first word
//   and the next word's initial ("Cobot P."), a lead's contact and a teammate to their first name;
// - what of the Board leaves the Mac: no decisions, proposals, chat lines or replies;
// - the signed link: t = base64url("<exp>.<person>") + "." + base64url(HMAC-SHA256(secret, "<exp>.<person>")), exp in
//   Unix seconds, at most two hours ahead (the portal's lib/world-share.ts signs the same way);
// - a per-address rate limit.
import { createHmac, timingSafeEqual } from "node:crypto";

export const TOKEN_MAX_S = 2 * 60 * 60;
export const RATE_LIMIT = 60;
export const RATE_WINDOW_MS = 60_000;
export const STATE_MAX_AGE_MS = 15_000;

// ---- masking ------------------------------------------------------------------------------------------------------------
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// any host name: words joined by dots ending in two or more letters ("cobot.com", "blckalpaca.at"), except file names
const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+|\b(?:[a-z0-9-]+\.)+(?!(?:json|jsonl|md|py|ts|tsx|js|mjs|txt|csv|toml|png|jpe?g|pdf|html?|log|db|sqlite)\b)[a-z]{2,}\b(?:\/\S*)?/gi;
const MODEL = /\bapi\.(?:[a-z0-9-]+\.)+[a-z]{2,}\/([\w.:-]+)/gi;
const PHONE = /\+?\d[\d ()./-]{7,}\d/g;
const ISO = /^\d{4}-\d\d-\d\d(?:[T ][\d:.]+(?:Z|[+-]\d\d:?\d\d)?)?$/;
const DATEISH = /^\d{4}-\d\d-\d\d/;

/** Keys whose values are addresses or pictures of pages: emptied whatever they hold. */
export const DROP_KEYS = new Set(["url", "href", "shot", "link", "domain", "email", "phone", "website", "whatsapp", "src"]);
/** Keys holding times: left as they are (a timestamp is no phone number). */
const TIME_KEYS = new Set(["ts", "at", "since", "from", "to", "until", "newest", "last_at", "lastAt", "time"]);

/** "Cobot Partners LLC" -> "Cobot P."; one word stays as it is. */
export function shortBusiness(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words[0] ?? "";
  const next = words.slice(1).find((w) => /[A-Za-z0-9]/.test(w)) ?? "";
  const initial = next.replace(/^[^A-Za-z0-9]+/, "").charAt(0).toUpperCase();
  return initial ? `${words[0]} ${initial}.` : words[0];
}

const firstName = (name: string) => name.trim().split(/[\s,]+/)[0] ?? "";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type MaskSource = { leads: { business?: string | null; contact?: string | null }[]; team: string[] };
export type Masker = (s: string) => string;

/** The masking for one state: addresses, numbers and links out; leads' and people's names shortened. */
export function makeMasker(src: MaskSource): Masker {
  const swap = new Map<string, string>();
  for (const l of src.leads) {
    const b = (l.business ?? "").trim();
    if (b.length >= 4 && b.split(/\s+/).length >= 2) swap.set(b.toLowerCase(), shortBusiness(b));
    const c = (l.contact ?? "").trim();
    if (c.length >= 4 && c.split(/\s+/).length >= 2) swap.set(c.toLowerCase(), firstName(c));
  }
  for (const t of src.team) {
    const n = t.trim();
    if (n.split(/\s+/).length >= 2) swap.set(n.toLowerCase(), firstName(n));
  }
  const keys = [...swap.keys()].sort((a, b) => b.length - a.length);
  // one pattern per first character keeps each alternation small
  const groups = new Map<string, string[]>();
  for (const k of keys) groups.set(k[0], [...(groups.get(k[0]) ?? []), escape(k)]);
  const res = [...groups.values()].map((g) => new RegExp(`(?<![A-Za-z0-9])(?:${g.join("|")})(?![A-Za-z0-9])`, "gi"));
  return (input: string) => {
    // a model label ("api.z.ai/glm-4.5-flash"): the model's name, without the provider's host
    let s = input.replace(EMAIL, "[email]").replace(MODEL, "$1").replace(URL_RE, "[link]");
    s = s.replace(PHONE, (m) => (DATEISH.test(m) || m.replace(/\D/g, "").length < 9 ? m : "[phone]"));
    for (const re of res) s = s.replace(re, (m) => swap.get(m.toLowerCase()) ?? m);
    return s;
  };
}

/** Every string in `value` masked; address and picture keys emptied; time keys left alone. */
export function maskDeep(value: unknown, mask: Masker, key = ""): unknown {
  if (DROP_KEYS.has(key)) return typeof value === "string" ? "" : value === null || value === undefined ? value : null;
  if (typeof value === "string") return TIME_KEYS.has(key) && ISO.test(value) ? value : ISO.test(value) ? value : mask(value);
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, mask));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskDeep(v, mask, k);
    return out;
  }
  return value;
}

// ---- the state --------------------------------------------------------------------------------------------------------
export type FeedOf = { thought?: string | null; feed: { ts: string; words: string; verdict: string; reason?: string | null; thought?: string | null }[] };
export type PublicState = {
  at: string;
  board: Record<string, unknown>;
  web: unknown;
  feeds: Record<string, FeedOf>;
  /** The calm pause line (a planned judge trial) and the Validator's tick line, as the dashboard shows them. */
  lines: { trial: string | null; tick: { text: string; stale: boolean } | null };
};

/** The Board with what never leaves the Mac taken out: the owner's decisions and the CEO's proposals, the chat lines
 *  and replies, a local tunnel address. */
export function publicBoard(board: Record<string, unknown>): Record<string, unknown> {
  return { ...board, proposals: [], decisions: [], counts: { decisions: 0, proposals: 0, requests: 0 }, replies: {}, chat: {}, portalLocal: null };
}

/** The state the public world polls, masked whole. A Feed keeps its time, words, verdict and reason only. */
export function publicState(input: { board: Record<string, unknown>; web: unknown; feeds: Record<string, FeedOf | null>; trial: string | null; tick: { text: string; stale: boolean } | null }, mask: Masker): PublicState {
  const feeds: Record<string, FeedOf> = {};
  for (const [slug, f] of Object.entries(input.feeds)) {
    if (!f) continue;
    feeds[slug] = { thought: f.thought ?? null, feed: (f.feed ?? []).slice(0, 20).map((x) => ({ ts: x.ts, words: x.words, verdict: x.verdict, reason: x.reason ?? null })) };
  }
  const raw = { at: String(input.board.at ?? new Date().toISOString()), board: publicBoard(input.board), web: input.web, feeds, lines: { trial: input.trial, tick: input.tick } };
  return maskDeep(raw, mask) as PublicState;
}

/** True when a masked text still holds an address or a long number. */
export function leaksText(text: string): boolean {
  if (ISO.test(text)) return false;
  const digits = text.replace(/\d{4}-\d\d-\d\d[T ][\d:.]+/g, "").replace(/[ ()./-]/g, "");
  return /[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(text) || /https?:\/\//i.test(text) || /\bwww\./i.test(text) || /\+?\d{9,}/.test(digits);
}

/** True when any string in `value` leaks (the server's last check before a state goes out); numbers are not text. */
export function leaks(value: unknown, key = ""): boolean {
  if (typeof value === "string") return !TIME_KEYS.has(key) && leaksText(value);
  if (Array.isArray(value)) return value.some((v) => leaks(v));
  if (value && typeof value === "object") return Object.entries(value).some(([k, v]) => leaks(v, k));
  return false;
}

// ---- the signed link --------------------------------------------------------------------------------------------------
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest();

/** A link token for `person`, good until `exp` (Unix seconds). */
export function signToken(secret: string, person: string, exp: number): string {
  const payload = `${Math.floor(exp)}.${person.replace(/\s+/g, " ").trim().slice(0, 60)}`;
  return `${b64url(payload)}.${b64url(mac(secret, payload))}`;
}

/** The person and expiry of a good token, else null: a bad signature, an expired one, or one longer than two hours. */
export function verifyToken(secret: string, token: string | null | undefined, nowS: number): { person: string; exp: number } | null {
  if (!secret || !token || token.length > 400) return null;
  const [p, sig, extra] = token.split(".");
  if (!p || !sig || extra !== undefined) return null;
  let payload: string;
  try {
    payload = Buffer.from(p, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const want = mac(secret, payload);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const dot = payload.indexOf(".");
  const exp = Number(payload.slice(0, dot));
  if (dot < 1 || !Number.isInteger(exp) || exp <= nowS || exp > nowS + TOKEN_MAX_S + 60) return null;
  return { person: payload.slice(dot + 1), exp };
}

// ---- the rate limit -------------------------------------------------------------------------------------------------
/** At most `limit` requests per address in any `windowMs`; answers whether this one may go on. */
export function makeLimiter(limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS) {
  const seen = new Map<string, number[]>();
  return (ip: string, now: number): boolean => {
    const recent = (seen.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      seen.set(ip, recent);
      return false;
    }
    recent.push(now);
    seen.set(ip, recent);
    if (seen.size > 5000) for (const [k, v] of seen) if (!v.some((t) => now - t < windowMs)) seen.delete(k);
    return true;
  };
}

/** The three routes; anything else is a 404. */
export function routeOf(method: string, path: string): "page" | "state" | null {
  if (method !== "GET" && method !== "HEAD") return null;
  if (path === "/") return "page";
  if (path === "/state") return "state";
  return null;
}
