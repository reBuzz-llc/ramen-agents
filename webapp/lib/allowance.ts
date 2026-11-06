// The free allowance, provider by provider (the goal "drain every free token"):
// how much of each free tier the family has used today and how much is left, so nothing free goes unspent and nothing
// dead stays unnoticed. Read-only, from files on this Mac; no key is ever read, only the key files' names.
//
//   chain:  common-data/configs/web-bots.toml (provider_chain, each provider's calls_per_day and, when set, tokens_per_day or
//           tokens_per_month), common-data/shared-state/model_calls.json (today's calls, tokens and each host's last
//           ok/fail), usage-history.json (this month's earlier days, for the monthly tiers' paced budget).
//   keyed, not in the chain: the key files' names, the search engines' *-usage.json, email-verify.json, usage-history.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type Health = { lastOk: string | null; lastFail: string | null; firstFail: string | null; reason: string };
export type ChainRow = {
  name: string;
  host: string;
  calls: number;
  callsCap: number | null;
  tokens: number;
  /** The token-bound tier: per day, or per month with today's paced share (what is left / days left this month). */
  tokenLimit: { per: "day" | "month"; limit: number | null; monthUsed?: number; pacedToday?: number } | null;
  /** What is left today: calls, and tokens when the tier is token-bound (null: not known). */
  left: { calls: number | null; tokens: number | null };
  /** The larger of the calls and tokens shares used today (0..1), for the meter; null without any cap. */
  used: number | null;
  health: Health;
  status: "ok" | "near" | "dead" | "idle";
  note: string;
};
export type IdleRow = { name: string; kind: "search" | "verifier" | "model" | "other"; lastUse: string | null; today: number | null; cap: string; note: string };
export type Allowance = { at: string; day: string; chain: ChainRow[]; idle: IdleRow[]; since: string | null; alerts: string[] };

// Token-bound tiers the config does not state yet (set tokens_per_day or tokens_per_month in the
// provider tables; a value there wins). Groq: gpt-oss-120b's 200k tokens a day (its rate-limit headers). Gonka Broker:
// about 1M tokens a month (freellm.net). Ollama Cloud: a monthly cap whose size is not published.
const TOKEN_TIERS: Record<string, { per: "day" | "month"; limit: number | null; note?: string }> = {
  groq: { per: "day", limit: 200_000 },
  "gonka-broker": { per: "month", limit: 1_000_000 },
  "ollama-cloud": { per: "month", limit: null, note: "monthly cap, size not published" },
};
// Hosts of providers with no table in web-bots.toml (out of the chain), to find their last use in the history.
const KNOWN_HOSTS: Record<string, string> = {
  "dahl-inference": "inference.dahl.global",
  orcarouter: "api.orcarouter.ai",
  freeai: "api.free.ai",
  freetheai: "freetheai",
  replicate: "api.replicate.com",
};
// Key files that are not providers of free work, or not this page's business.
const NOT_PROVIDERS = /^(peek-|notion$|cloudflare-r2$)/;
const SEARCH: Record<string, { file: string; capKey: string; cap: number; note: string }> = {
  tavily: { file: "tavily-usage.json", capKey: "tavily_per_day", cap: 30, note: "keyed search, kept for special searches" },
  langsearch: { file: "langsearch-usage.json", capKey: "langsearch_per_day", cap: 100, note: "automatic backup when the keyless engines fail" },
  parallel: { file: "parallel-usage.json", capKey: "parallel_per_day", cap: 30, note: "second automatic backup" },
};
const VERIFIERS: Record<string, { by: string | null; cap: string }> = {
  quickemailverification: { by: null, cap: "100 a day" },
  sniffmail: { by: "sniffmail", cap: "500 a month" },
  ezverify: { by: "ezverify", cap: "on file, unused" },
};

type Toml = { chain: string[]; top: Record<string, string>; providers: Record<string, Record<string, string>> };

/** The few fields this page needs from web-bots.toml: provider_chain, top-level and [browser] numbers, and each
 *  [model.providers.<name>] table's keys. Not a general TOML parser. */
export function parseConfig(text: string): Toml {
  const out: Toml = { chain: [], top: {}, providers: {} };
  let table = "";
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const t = /^\[([^\]]+)\]$/.exec(line);
    if (t) {
      table = t[1].trim();
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === "provider_chain") out.chain = [...value.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const p = /^model\.providers\.(.+)$/.exec(table);
    const v = value.replace(/^"(.*)"$/, "$1").replace(/_/g, "");
    if (p) (out.providers[p[1]] ??= {})[key] = value.replace(/^"(.*)"$/, "$1");
    else out.top[key] = v;
  }
  return out;
}

const hostOf = (name: string, base: string | undefined) => {
  if (name === "gemini") return "gemini";
  try {
    return base ? new URL(base).hostname : KNOWN_HOSTS[name] ?? name;
  } catch {
    return name;
  }
};
const num = (v: string | undefined) => {
  const n = Number((v ?? "").replace(/_/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

type Calls = {
  day?: string;
  counts?: Record<string, number>;
  usage?: Record<string, Record<string, [number, number, number]>>;
  health?: Record<string, { last_ok?: string; last_fail?: string; first_fail?: string; last_reason?: string }>;
};
type History = { since?: string; days?: Record<string, { hosts?: Record<string, { calls: number; tokens: number }> }> };

/** Days left in the month, today included (local date "YYYY-MM-DD"). */
export function daysLeft(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m, 0).getDate() - d + 1;
}

/** The allowance from the files' contents (pure, for tests). */
export function allowanceOf(
  input: { config: string; calls: Calls; history: History; keys: string[]; search: Record<string, Record<string, number>>; verify: Record<string, { at?: string; by?: string }> },
  now: Date,
): Allowance {
  const cfg = parseConfig(input.config);
  const day = input.calls.day ?? localDay(now);
  const month = day.slice(0, 7);
  const histDays = Object.entries(input.history.days ?? {});
  const chain: ChainRow[] = cfg.chain.map((name) => {
    const p = cfg.providers[name] ?? {};
    const host = hostOf(name, p.base_url);
    const kinds = Object.values(input.calls.usage?.[host] ?? {});
    const calls = Math.max(input.calls.counts?.[host] ?? 0, kinds.reduce((n, k) => n + (k[0] ?? 0), 0));
    const tokens = kinds.reduce((n, k) => n + (k[1] ?? 0) + (k[2] ?? 0), 0);
    const callsCap = num(p.calls_per_day);
    const tier = num(p.tokens_per_day) ? { per: "day" as const, limit: num(p.tokens_per_day) } : num(p.tokens_per_month) ? { per: "month" as const, limit: num(p.tokens_per_month) } : (TOKEN_TIERS[name] ?? null);
    let tokenLimit: ChainRow["tokenLimit"] = null;
    let tokensLeft: number | null = null;
    let tokenShare: number | null = null;
    if (tier) {
      if (tier.per === "day") {
        tokenLimit = { per: "day", limit: tier.limit };
        if (tier.limit) {
          tokensLeft = Math.max(0, tier.limit - tokens);
          tokenShare = tokens / tier.limit;
        }
      } else {
        const before = histDays.filter(([d]) => d.startsWith(month) && d < day).reduce((n, [, v]) => n + (v.hosts?.[host]?.tokens ?? 0), 0);
        const paced = tier.limit ? Math.max(0, Math.floor((tier.limit - before) / daysLeft(day))) : undefined;
        tokenLimit = { per: "month", limit: tier.limit, monthUsed: before + tokens, pacedToday: paced };
        if (paced !== undefined) {
          tokensLeft = Math.max(0, paced - tokens);
          tokenShare = paced ? tokens / paced : 1;
        }
      }
    }
    const callShare = callsCap ? calls / callsCap : null;
    const h = input.calls.health?.[host] ?? {};
    const health: Health = { lastOk: h.last_ok ?? null, lastFail: h.last_fail ?? null, firstFail: h.first_fail ?? null, reason: h.last_reason ?? "" };
    const dead = !!health.lastFail && (!health.lastOk || health.lastFail > health.lastOk);
    const used = callShare === null && tokenShare === null ? null : Math.max(callShare ?? 0, tokenShare ?? 0);
    const status: ChainRow["status"] = dead ? "dead" : used !== null && used >= 0.9 ? "near" : calls === 0 ? "idle" : "ok";
    const note = dead
      ? health.lastOk
        ? `not answering since ${(health.firstFail ?? health.lastFail ?? "").slice(5, 16).replace("T", " ")}${health.reason ? ` (${health.reason})` : ""}`
        : `has never answered${health.reason ? ` (${health.reason})` : ""}`
      : (TOKEN_TIERS[name]?.note ?? "");
    return { name, host, calls, callsCap, tokens, tokenLimit, left: { calls: callsCap ? Math.max(0, callsCap - calls) : null, tokens: tokensLeft }, used, health, status, note };
  });

  const inChain = new Set(cfg.chain);
  const lastInHistory = (host: string) => {
    const hit = histDays.filter(([, v]) => (v.hosts?.[host]?.calls ?? 0) > 0).map(([d]) => d).sort().pop();
    return hit ?? null;
  };
  const idle: IdleRow[] = input.keys
    .filter((k) => !inChain.has(k) && !NOT_PROVIDERS.test(k))
    .sort()
    .map((name): IdleRow => {
      const s = SEARCH[name];
      if (s) {
        const days = input.search[name] ?? {};
        const used = Object.entries(days).filter(([, n]) => n > 0).map(([d]) => d).sort();
        const cap = num(cfg.top[s.capKey]) ?? s.cap;
        return { name, kind: "search", lastUse: used.at(-1) ?? null, today: days[day] ?? 0, cap: `${cap} a day`, note: s.note };
      }
      const v = VERIFIERS[name];
      if (v) {
        const ats = Object.values(input.verify)
          .filter((e) => (v.by === null ? !e.by || e.by === "quickemailverification" : e.by === v.by))
          .map((e) => e.at ?? "")
          .filter(Boolean)
          .sort();
        const last = ats.at(-1);
        return { name, kind: "verifier", lastUse: last ? last.slice(0, 16).replace("T", " ") : null, today: ats.filter((x) => x.startsWith(day)).length, cap: v.cap, note: "checks a lead's email before it is recorded" };
      }
      const p = cfg.providers[name];
      const host = hostOf(name, p?.base_url);
      return {
        name,
        kind: p || KNOWN_HOSTS[name] ? "model" : "other",
        lastUse: lastInHistory(host),
        today: null,
        cap: p ? "paid key, in no chain" : "",
        note: p ? "a paid key: kept on file, in no chain" : "",
      };
    });

  const alerts = chain.filter((r) => r.status === "dead" || r.status === "near").map((r) => (r.status === "dead" ? `${r.name} not answering` : `${r.name} at ${Math.round((r.used ?? 0) * 100)}%`));
  return { at: now.toISOString(), day, chain, idle, since: input.history.since ?? null, alerts };
}

function localDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const readJson = async <T,>(file: string, fallback: T): Promise<T> => readFile(/*turbopackIgnore: true*/ file, "utf8").then((t) => JSON.parse(t) as T, () => fallback);

/** The allowance now, from the files under `bots` (~/bots). */
export async function readAllowance(bots: string, now = new Date()): Promise<Allowance> {
  const shared = path.join(bots, "common-data", "shared-state");
  const [config, calls, history, keyFiles, verify, ...search] = await Promise.all([
    readFile(/*turbopackIgnore: true*/ path.join(bots, "common-data", "configs", "web-bots.toml"), "utf8").catch(() => ""),
    readJson<Calls>(path.join(shared, "model_calls.json"), {}),
    readJson<History>(path.join(shared, "usage-history.json"), {}),
    readdir(/*turbopackIgnore: true*/ path.join(bots, "common-data", "keys")).catch(() => [] as string[]),
    readJson<Record<string, { at?: string; by?: string }>>(path.join(shared, "email-verify.json"), {}),
    ...Object.values(SEARCH).map((s) => readJson<Record<string, number>>(path.join(shared, s.file), {})),
  ]);
  const keys = [...new Set(keyFiles.filter((f) => f.endsWith(".key")).map((f) => f.replace(/\.key$/, "")))];
  return allowanceOf({ config, calls, history, keys, search: Object.fromEntries(Object.keys(SEARCH).map((k, i) => [k, search[i]])), verify }, now);
}
