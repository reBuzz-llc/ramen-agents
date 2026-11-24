// Every provider ramen-agents knows, as common-data/providers.json lists it: the one list the Providers page, add-key.sh
// and setup-check.py read. Pure (no file or network access), so Node's own test runner can load it.
//
// A provider's "mark" says how it was judged, and by whom:
//   usable    worth a key (by the owner or the maintainers);
//   unusable  tested by the owner and found wanting (needs a card, not free, not an API), with the reason and the date;
//   rejected  set aside by the maintainers on paper, without the owner's test, with the reason and the date;
//   null      listed, not judged yet: what its own page says, and when it was read.
// A marked provider can still take a key, but only behind its note; nothing marked is ever suggested.

export type Mark = "usable" | "unusable" | "rejected" | null;
export type Use = "model" | "email-check" | "search" | "tool" | "board";
export type TestSpec = { kind: "models"; url: string; auth: string } | { kind: "none" };

export type ProviderEntry = {
  name: string;
  who: string;
  use: Use;
  key_file: string;
  add_key: string;
  where: string;
  status: "chain" | "opt-in" | "removed";
  free: boolean;
  card: string;
  added: string;
  changed: string;
  mark: Mark;
  mark_by: "owner" | "maintainers" | "";
  mark_date: string;
  mark_note: string;
  test: TestSpec;
};

/** The person's own mark on a provider, kept on this Mac only (common-data/local/provider-marks.json). */
export type OwnMark = { mark: "unusable" | "needs-billing"; note: string; at: string };

export type Group = "chain" | "free" | "paid" | "listed" | "unusable" | "set-aside" | "removed";

export const GROUPS: { key: Group; title: string; line: string }[] = [
  { key: "chain", title: "In the default chain", line: "Free model tiers the members use in this order. One key is enough to start." },
  { key: "free", title: "Other free keys", line: "Optional: each adds something, and none is needed." },
  { key: "paid", title: "Only if you pay", line: "Not free. Add one only if you choose to pay; setup never asks for it." },
  { key: "listed", title: "Listed, not judged yet", line: "What each provider's own page says, and when we read it. Nobody has tested these yet." },
  { key: "unusable", title: "Unusable", line: "Tested by the owner and found wanting. The reason and the date are on each row." },
  { key: "set-aside", title: "Set aside by the maintainers", line: "Judged on paper, not tested: the reason and the date are on each row." },
  { key: "removed", title: "No longer used", line: "Kept here so an old key file makes sense." },
];

export function groupOf(p: ProviderEntry): Group {
  if (p.status === "removed") return "removed";
  if (p.mark === "unusable") return "unusable";
  if (p.mark === "rejected") return "set-aside";
  if (p.status === "chain") return "chain";
  if (p.mark === null) return "listed";
  return p.free ? "free" : "paid";
}

/** What the mark says, in one line: "Unusable (owner, 2026-11-18): Pay-as-you-go from the first call." */
export function markLine(p: ProviderEntry): string {
  if (p.mark === null) return "Listed, not judged yet.";
  const who = p.mark === "rejected" ? "Set aside by the maintainers" : p.mark === "unusable" ? "Unusable" : "Usable";
  const by = p.mark === "rejected" ? "" : p.mark_by;
  const meta = [by, p.mark_date].filter(Boolean).join(", ");
  return `${who}${meta ? ` (${meta})` : ""}${p.mark_note ? `: ${p.mark_note}` : "."}`;
}

/** Setup may suggest it: marked usable, free, added with the key script, and not gone. An unjudged one never is. */
export const suggestable = (p: ProviderEntry) => p.mark === "usable" && p.free && p.add_key !== "" && p.status !== "removed";

/** A key goes behind a confirm: the provider was judged unusable or set aside. */
export const needsConfirm = (p: ProviderEntry) => p.mark === "unusable" || p.mark === "rejected";

const NAME = /^[a-z0-9][a-z0-9-]{1,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The entries of providers.json, each checked; a malformed entry is left out and named. */
export function parseList(raw: unknown): { entries: ProviderEntry[]; skipped: string[] } {
  const list = (raw as { providers?: unknown })?.providers;
  const entries: ProviderEntry[] = [];
  const skipped: string[] = [];
  if (!Array.isArray(list)) return { entries, skipped: ["providers.json has no providers list"] };
  for (const x of list as Record<string, unknown>[]) {
    const name = typeof x?.name === "string" ? x.name : "";
    const ok =
      NAME.test(name) &&
      x.key_file === `${name}.key` &&
      ["model", "email-check", "search", "tool", "board"].includes(x.use as string) &&
      ["chain", "opt-in", "removed"].includes(x.status as string) &&
      typeof x.free === "boolean" &&
      [null, "usable", "unusable", "rejected"].includes(x.mark as string | null) &&
      (x.mark === null || DAY.test(String(x.mark_date))) &&
      typeof x.test === "object" && x.test !== null;
    if (!ok) {
      skipped.push(name || "an entry with no name");
      continue;
    }
    entries.push(x as unknown as ProviderEntry);
  }
  return { entries, skipped };
}

/** The request a key test makes: always a free read (a models list or the account), never a completion. The key goes in
 *  a header unless the provider offers nothing but a query parameter. null: this provider has no free read. */
export function testRequest(spec: TestSpec, key: string): { url: string; headers: Record<string, string> } | null {
  if (spec.kind !== "models" || !/^https:\/\//.test(spec.url)) return null;
  if (spec.auth === "bearer") return { url: spec.url, headers: { authorization: `Bearer ${key}` } };
  if (spec.auth === "x-api-key") return { url: spec.url, headers: { "x-api-key": key } };
  const header = /^header:([A-Za-z0-9-]{1,40})$/.exec(spec.auth);
  if (header) return { url: spec.url, headers: { [header[1].toLowerCase()]: key } };
  const query = /^query:([A-Za-z0-9_]{1,40})$/.exec(spec.auth);
  if (query) {
    const u = new URL(spec.url);
    u.searchParams.set(query[1], key);
    return { url: u.toString(), headers: {} };
  }
  return null;
}

export type TestLevel = "works" | "rejected" | "no-quota" | "untested";
export type TestOutcome = { ok: boolean; level: TestLevel; message: string };

/** A free read's answer in words. 2xx: the key works; 401/403: a wrong key; anything else: saved, not tested. */
export function testOutcome(who: string, status: number, why = ""): TestOutcome {
  const tail = why ? `: ${why}` : "";
  if (status >= 200 && status < 300) return { ok: true, level: "works", message: `Key works: ${who} answered a free read.` };
  if (status === 401 || status === 403) return { ok: false, level: "rejected", message: `Key rejected (${status})${tail}` };
  if (status === 402 || status === 429) return { ok: false, level: "no-quota", message: `Saved; ${who} answered ${status} (no quota or credit right now)${tail}` };
  return { ok: false, level: "untested", message: `Saved, not tested: ${who} answered ${status}${tail}` };
}

export const NOT_TESTED: TestOutcome = { ok: false, level: "untested", message: "Saved, not tested: this provider has no free read to test a key with." };

/** A provider's error text, with the key and anything key-like taken out, short. */
export function cleanReason(text: string, key: string): string {
  let msg = text;
  try {
    const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string; detail?: string };
    msg = (typeof j.error === "string" ? j.error : j.error?.message) ?? j.message ?? j.detail ?? text;
  } catch {
    /* plain text */
  }
  if (/<\/?(html|body|head|title)\b/i.test(msg)) msg = msg.replace(/<head>[\s\S]*?<\/head>/i, "").replace(/<[^>]+>/g, " ");
  return (key ? msg.split(key).join("…") : msg).replace(/[A-Za-z0-9_-]{24,}/g, "…").replace(/\s+/g, " ").trim().slice(0, 160);
}

/** One member's view of the keys it reads: its model chain, its search engines and every config string naming a key file. */
export type MemberKeys = { name: string; chain: string[]; engines: string[]; strings: string[] };

/** The members that use this provider: in their chain, in their search engines, or naming its key file in a setting. */
export function usedBy(p: ProviderEntry, members: MemberKeys[]): string[] {
  const file = `/keys/${p.key_file}`;
  return members
    .filter((m) => m.chain.includes(p.name) || m.engines.includes(p.name) || m.strings.some((s) => s.endsWith(file)))
    .map((m) => m.name);
}
