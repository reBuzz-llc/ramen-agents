// Server-side only: every key on this Mac in one view, for Settings > Key providers > Overview (owner, 2026-10-02:
// "an additional tab that shows usage and availability of each key"). Read-only and free to compute:
//   - which keys are on disk (common-data/keys), what kind each is, and which bots use it (every bot's model chain);
//   - today's usage: model calls and tokens per host (shared-state/model_calls.json), email checks and credits left
//     (email-verify.json), Tavily searches against the fleet's 30-a-day cap (tavily-usage.json);
//   - availability: when a provider last hit a rate limit or daily cap in the bots' logs ("... (429); not using it for
//     15 minutes") -- paused now if that was under 15 minutes ago -- and the non-model services' own checks;
//   - the free-tier limit as the owner's notes record it, and the weekly terms watch.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { BotProfile } from "./bot";
import { BOTS_DIR, readConfig } from "./bots";
import { agentPids, flags } from "./control";
import { KEYS_DIR, providerCatalog, type ProviderInfo } from "./keys";
import { serviceStatuses } from "./services";

const SHARED = path.join(BOTS_DIR, "common-data", "shared-state");
const WATCH = path.join(BOTS_DIR, "common-data", "provider-watch-report.md");
const PAUSE_MIN = 15;

export type KeyKind = "AI model" | "Email check" | "Search" | "Storage" | "Workspace";
export type KeyRow = {
  name: string;
  file: string | null; // the key file on disk, or null when the provider is known but has no key
  kind: KeyKind;
  usedBy: string[]; // bots whose model chain includes it (models), or what uses it (services)
  position: string; // where it sits in the running bots' chains ("1st for Lead Gen, Scout")
  stoppedBy: string[]; // stopped bots whose chain also lists it: they hold nothing while stopped
  free: string; // the free tier as recorded (limits)
  paid: boolean; // pay-as-you-go: kept only as a last resort
  today: string; // usage today in words
  callsToday: number;
  tokensToday: number;
  limitHits24h: number; // rate-limit or daily-cap refusals in the last 24 h
  lastLimit: string | null; // when it last hit one
  available: "ready" | "on file" | "paused" | "limited" | "not working" | "no key" | "unused";
  pauseMin: number; // how long the bots skip it after a limit hit (from the engine's own log line)
  note: string;
};
// A quota as a bar (owner, 2026-10-02: "something like" a usage meter -- label, percent, bar, "Resets in 1h").
export type UsageBar = {
  group: "Free quotas" | "Bot daily budgets";
  sub?: boolean; // a bot under the fleet pool bar, drawn indented
  label: string;
  used: number;
  limit: number | null; // null = no cap (shown without a bar)
  detail: string; // "38 of 100 checks"
  resetsAt: string | null; // ISO; the page shows "Resets in 5h"
  resetNote: string; // what the reset is based on
  badge?: string; // shown instead of a percent (a pause)
};
export type KeyOverview = {
  fleetTokens: number; // every bot's model tokens today (the same count the token pool uses)
  rows: KeyRow[];
  usage: UsageBar[];
  watch: { date: string; changed: string; headline: string } | null;
  generatedAt: string;
};

// Free-tier limits as the owner's notes and the providers' pages record them (memory, providers-found.md).
const FREE: Record<string, string> = {
  groq: "8k tokens/min, 200k tokens/day per model",
  gemini: "free tier, per-minute and per-day caps",
  "ollama-cloud": "free plan, hourly and daily caps",
  zai: "glm-4.5-flash at $0",
  openrouter: "~50 requests/day on :free models",
  speka: "$1 of usage a month",
  mistral: "free plan (activate in console)",
  orcarouter: "free models (account must be established)",
  quickemailverification: "100 checks a day",
  sniffmail: "500 basic checks a month",
  ezverify: "200 checks a month",
  tavily: "1,000 credits a month (fleet cap 30/day)",
  notion: "free plan (single-member workspace)",
  "cloudflare-r2": "10 GB storage free (needs R2 switched on)",
};
const PAID = new Set(["deepseek", "openai", "moonshot", "replicate", "together", "cerebras"]);
const SERVICE_KIND: Record<string, KeyKind> = {
  quickemailverification: "Email check",
  sniffmail: "Email check",
  ezverify: "Email check",
  tavily: "Search",
  "cloudflare-r2": "Storage",
  notion: "Workspace",
  orcarouter: "AI model",
};

const localDay = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

async function json<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(/*turbopackIgnore: true*/ file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Rate-limit or daily-cap refusals per host over the last 24 h, from every bot's log. */
async function limitEvents(bots: BotProfile[]): Promise<Map<string, { n: number; last: string; pauseMin: number }>> {
  const since = new Date(Date.now() - 24 * 3600e3);
  const sinceIso = new Date(since.getTime() - since.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  const out = new Map<string, { n: number; last: string; pauseMin: number }>();
  for (const bot of bots) {
    let text = "";
    try {
      const file = path.join(path.dirname(bot.configPath), "workspace", "logs", "explorer.jsonl");
      const st = await stat(/*turbopackIgnore: true*/ file);
      // The tail is enough for 24 h and keeps a multi-megabyte log cheap.
      const buf = await readFile(/*turbopackIgnore: true*/ file);
      text = buf.subarray(Math.max(0, st.size - 4_000_000)).toString("utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.includes("rate limit or daily cap")) continue;
      const ts = /"ts":\s*"([^"]+)"/.exec(line)?.[1] ?? "";
      if (ts < sinceIso) continue;
      const host = /"msg":\s*"([a-z0-9.-]+)\//i.exec(line)?.[1]?.toLowerCase();
      if (!host) continue;
      const e = out.get(host) ?? { n: 0, last: "", pauseMin: PAUSE_MIN };
      e.n++;
      if (ts > e.last) {
        e.last = ts;
        // The engine names the pause in the line ("not using it for 60 minutes"); OpenRouter's is an hour.
        const m = /not using it for ([0-9.]+) minutes?/.exec(line);
        e.pauseMin = m ? Number(m[1]) : PAUSE_MIN;
      }
      out.set(host, e);
    }
  }
  return out;
}

const g = globalThis as { __keyOverview?: { at: number; data: KeyOverview } };

export async function keyOverview(bots: BotProfile[], fresh = false): Promise<KeyOverview> {
  if (!fresh && g.__keyOverview && Date.now() - g.__keyOverview.at < 60_000) return g.__keyOverview.data;
  const day = localDay();
  const [files, catalogs, calls, verify, tavily, events, services] = await Promise.all([
    readdir(/*turbopackIgnore: true*/ KEYS_DIR).catch(() => [] as string[]),
    Promise.all(bots.map(async (b) => ({ bot: b, cat: await providerCatalog(b).catch(() => null) }))),
    json<{ day?: string; counts?: Record<string, number>; usage?: Record<string, Record<string, number[]>> }>(path.join(SHARED, "model_calls.json"), {}),
    json<Record<string, { at?: string; credits?: string; by?: string }>>(path.join(SHARED, "email-verify.json"), {}),
    json<Record<string, number>>(path.join(SHARED, "tavily-usage.json"), {}),
    limitEvents(bots),
    serviceStatuses(),
  ]);

  // Which bots are running: a stopped or paused bot holds no key (owner, 2026-10-02: keys looked "assigned to
  // inactive members"), so the Used by column lists running bots and names the stopped ones apart.
  const running = new Set<string>();
  await Promise.all(
    bots.map(async (b) => {
      const f = await flags(b).catch(() => [] as string[]);
      if (f.includes("STOP") || f.includes("PAUSE")) return;
      const pids = await agentPids(b.configPath, path.join(path.dirname(b.configPath), "workspace", "explorer.pid")).catch(() => [] as number[]);
      if (pids.length) running.add(b.name);
    }),
  );

  // Every model provider any bot knows, with the bots whose chain holds it and where.
  const models = new Map<string, { info: ProviderInfo; chains: { bot: string; pos: number }[] }>();
  for (const { bot, cat } of catalogs) {
    if (!cat) continue;
    for (const p of [...cat.chain, ...cat.known]) {
      const m = models.get(p.name) ?? { info: p, chains: [] };
      if (p.position && cat.chain.some((c) => c.name === p.name)) m.chains.push({ bot: bot.name, pos: p.position });
      models.set(p.name, m);
    }
  }
  const keyNames = new Set(files.filter((f) => /\.(key|json)$/.test(f)).map((f) => f.replace(/\.(key|json)$/, "")));
  const usage = calls.day === day ? (calls.usage ?? {}) : {};
  const counts = calls.day === day ? (calls.counts ?? {}) : {}; // every call per host; usage[] has tokens for some only
  const svc = new Map(services.map((s) => [s.file.replace(/\.(key|json)$/, ""), s]));
  const now = Date.now();

  const rows: KeyRow[] = [];
  for (const [name, m] of models) {
    const host = ((m.info as ProviderInfo & { host?: string }).host ?? "").toLowerCase();
    const u = usage[host] ?? {};
    const callsToday = Math.max(counts[host] ?? 0, Object.values(u).reduce((a, v) => a + (v[0] ?? 0), 0));
    const tokensToday = Object.values(u).reduce((a, v) => a + (v[1] ?? 0) + (v[2] ?? 0), 0);
    const ev = events.get(host);
    const pausedNow = ev ? now - new Date(ev.last).getTime() < ev.pauseMin * 60000 : false;
    const hasKey = keyNames.has(name) || m.info.hasKey;
    // Group the running bots by position: "1st for Lead Gen, Scout" (one shared chain makes these the same).
    const live = m.chains.filter((c) => running.has(c.bot));
    const byPos = new Map<number, string[]>();
    for (const c of live) byPos.set(c.pos, [...(byPos.get(c.pos) ?? []), c.bot]);
    rows.push({
      name,
      file: hasKey ? `${name}.key` : null,
      kind: "AI model",
      usedBy: live.map((c) => c.bot),
      position: [...byPos.entries()].sort((a, b) => a[0] - b[0]).map(([pos, names]) => `${ordinal(pos)} for ${names.join(", ")}`).join("; "),
      stoppedBy: m.chains.filter((c) => !running.has(c.bot)).map((c) => c.bot),
      free: FREE[name] ?? (m.info.note || ""),
      paid: PAID.has(name),
      today: callsToday ? `${callsToday} calls${tokensToday ? `, ${tokensToday.toLocaleString()} tokens` : ""}` : "no calls today",
      callsToday,
      tokensToday,
      limitHits24h: ev?.n ?? 0,
      lastLimit: ev?.last ?? null,
      pauseMin: ev?.pauseMin ?? PAUSE_MIN,
      available: !hasKey ? "no key" : pausedNow ? "paused" : (ev?.n ?? 0) > 0 ? "limited" : live.length ? "ready" : "unused",
      note: !hasKey
        ? "Known to the bots, but no key on this Mac"
        : PAID.has(name)
          ? "Paid per call: in no chain (no spending)"
          : live.length
            ? ""
            : m.chains.length
              ? "Only stopped bots list it"
              : "Key on file, but in no bot's chain",
    });
    keyNames.delete(name);
  }

  // The keys that are not model providers (and any model key no bot knows yet).
  // Each verdict names the checker that gave it ("by"); none means QuickEmailVerification, the first in line.
  const checksAll = Object.values(verify).filter((v) => (v.at ?? "").startsWith(day));
  const byChecker = (who: string) => checksAll.filter((v) => (v.by ?? "quickemailverification") === who).length;
  const checksToday = checksAll.filter((v) => !v.by || v.by === "quickemailverification");
  // The newest verdict that carries QuickEmailVerification's remaining credits (cached or fallback ones do not).
  const latest = Object.values(verify)
    .filter((v) => v.credits !== undefined && v.credits !== null && v.credits !== "")
    .sort((a, b) => ((a.at ?? "") < (b.at ?? "") ? 1 : -1))[0];
  for (const name of keyNames) {
    const s = svc.get(name);
    let today = "";
    let callsToday = 0;
    if (name === "quickemailverification") {
      callsToday = checksToday.length;
      today = `${callsToday} emails checked today${latest?.credits ? `, ${latest.credits} credits left` : ""}`;
    } else if (name === "tavily") {
      callsToday = tavily[day] ?? 0;
      today = `${callsToday} of 30 searches today`;
    } else if (name === "sniffmail") {
      callsToday = byChecker("sniffmail") + byChecker("basic");
      today = callsToday ? `${callsToday} checks today (backup)` : "backup only: used when the daily checks run out";
    } else if (name === "ezverify") {
      callsToday = byChecker("ezverify");
      today = callsToday ? `${callsToday} checks today (third in line)` : "third in line: used when the first two do not answer";
    } else if (name === "notion") today = "the bots' board writes";
    else today = "not used yet";
    const kind = SERVICE_KIND[name] ?? "AI model";
    rows.push({
      name,
      file: files.find((f) => f.replace(/\.(key|json)$/, "") === name) ?? null,
      kind,
      usedBy: s ? [s.usedFor] : [],
      position: "",
      stoppedBy: [],
      free: FREE[name] ?? "",
      paid: PAID.has(name),
      today,
      callsToday,
      tokensToday: 0,
      limitHits24h: 0,
      lastLimit: null,
      pauseMin: PAUSE_MIN,
      // (1) "Ready" only when a check actually ran; a key nobody may call for free is "on file".
      available: s ? (s.ok === null ? "on file" : s.ok ? (s.verified === false ? "on file" : "ready") : "not working") : "on file",
      note: s?.detail ?? "",
    });
  }

  // Web search has no key, but it is the bots' main way to find things: its 3-hourly check (scripts/search_check.py,
  // shared-state/search-health.json) is a row too -- how many engines answered, which refused and why.
  const sh = await json<{ checked_at?: string; ok?: boolean; results?: number; answered?: Record<string, number>; refused?: Record<string, string>; thin?: boolean; error?: string; down_since?: string }>(
    path.join(SHARED, "search-health.json"),
    {},
  );
  if (sh.checked_at) {
    const answered = Object.keys(sh.answered ?? {});
    const refused = Object.entries(sh.refused ?? {});
    rows.push({
      name: "web search (SearXNG)",
      file: null,
      kind: "Search",
      usedBy: ["Every bot's searches (keyless engines on this Mac)"],
      position: "",
      stoppedBy: [],
      free: "keyless, no limit of ours",
      paid: false,
      today: sh.ok ? `${sh.results ?? 0} results on the last check, ${answered.length} engine${answered.length === 1 ? "" : "s"} answered` : "no results on the last check",
      callsToday: 0,
      tokensToday: 0,
      limitHits24h: refused.length,
      lastLimit: null,
      pauseMin: PAUSE_MIN,
      available: !sh.ok ? "not working" : sh.thin ? "limited" : "ready",
      note: [
        sh.ok ? "" : `${sh.error || "Search is down"}${sh.down_since ? ` (since ${sh.down_since.slice(0, 16).replace("T", " ")})` : ""}`,
        answered.length ? `Answered: ${answered.join(", ")}` : "",
        refused.length ? `Refused: ${refused.map(([e, why]) => `${e} (${why})`).join(", ")}` : "",
        `Checked ${sh.checked_at.slice(0, 16).replace("T", " ")}`,
      ]
        .filter(Boolean)
        .join(". "),
    });
  }

  const watchText = await readFile(/*turbopackIgnore: true*/ WATCH, "utf8").catch(() => "");
  const watch = watchText
    ? {
        date: /—\s*([0-9-]+(?: [0-9:]+)?)/.exec(watchText)?.[1] ?? "",
        changed: /changed:\s*(\d+)/.exec(watchText)?.[1] ?? "0",
        headline: [...watchText.matchAll(/^## (.+)$/gm)].map((m) => m[1]).slice(0, 6).join(", "),
      }
    : null;

  // ---- usage bars --------------------------------------------------------------------------------------------
  const next = (d: Date) => d.toISOString();
  const localMidnight = new Date(now);
  localMidnight.setHours(24, 0, 0, 0);
  const utcMidnight = new Date(now);
  utcMidnight.setUTCHours(24, 0, 0, 0);
  const monthStart = new Date(now);
  monthStart.setMonth(monthStart.getMonth() + 1, 1);
  monthStart.setHours(0, 0, 0, 0);
  const row = (n: string) => rows.find((r) => r.name === n);
  const usageBars: UsageBar[] = [];
  const qev = row("quickemailverification");
  if (qev?.file) {
    const left = latest?.credits !== undefined && latest?.at?.startsWith(day) ? Number(latest.credits) : null;
    const used = left !== null && Number.isFinite(left) ? Math.max(0, 100 - left) : checksToday.length;
    usageBars.push({ group: "Free quotas", label: "Email checks (QuickEmailVerification)", used, limit: 100, detail: `${used} of 100 today`, resetsAt: next(utcMidnight), resetNote: "daily, at midnight UTC" });
  }
  const tav = row("tavily");
  if (tav?.file) {
    usageBars.push({ group: "Free quotas", label: "Tavily searches today", used: tav.callsToday, limit: 30, detail: `${tav.callsToday} of 30 (the fleet's own cap)`, resetsAt: next(localMidnight), resetNote: "daily, at midnight here" });
    const m = /(\d+) of (\d+) credits/.exec(svc.get("tavily")?.detail ?? "");
    if (m) usageBars.push({ group: "Free quotas", label: "Tavily credits this month", used: Number(m[1]), limit: Number(m[2]), detail: `${m[1]} of ${m[2]} credits`, resetsAt: next(monthStart), resetNote: "monthly" });
  }
  const groq = row("groq");
  if (groq?.file) usageBars.push({ group: "Free quotas", label: "Groq tokens today", used: groq.tokensToday, limit: 200000, detail: `${groq.tokensToday.toLocaleString()} of 200,000 (per model)`, resetsAt: next(utcMidnight), resetNote: "daily, at midnight UTC" });
  const or = row("openrouter");
  if (or?.file) usageBars.push({ group: "Free quotas", label: "OpenRouter free requests today", used: or.callsToday, limit: 50, detail: or.callsToday === 0 && or.limitHits24h > 0 ? `0 of ~50: refused before any call counted (${or.limitHits24h} limit hits)` : `${or.callsToday} of ~50`, resetsAt: next(utcMidnight), resetNote: "daily, at midnight UTC" });
  for (const r of rows) {
    if (r.available !== "paused" || !r.lastLimit) continue;
    const back = new Date(new Date(r.lastLimit).getTime() + r.pauseMin * 60000);
    const done = Math.min(r.pauseMin, Math.max(0, (now - new Date(r.lastLimit).getTime()) / 60000));
    usageBars.push({ group: "Free quotas", label: `${r.name} (paused after a limit)`, used: r.pauseMin - done, limit: r.pauseMin, detail: `${r.limitHits24h} limit hits in 24 h`, resetsAt: next(back), resetNote: `the bots skip it for ${r.pauseMin} minutes after a limit hit`, badge: "Paused" });
  }
  // Token budgets. Since 2026-10-02 15:29 the fleet shares one pool (owner: "active members should take max
  // leverage"): [model] budget_scope = "active", fleet_token_budget a day, and each RUNNING bot (no STOP or PAUSE,
  // a live agent, weight > 0) gets budget_weight / (the running bots' weights) of what is left. A bot's allowance is
  // its tokens today plus that share of the pool left; weight 0 (The CEO) is never paced but spends from the pool.
  // This mirrors explorer.fleet_budget.active_share; a bot still on budget_scope = "bot" keeps its own daily cap.
  const byBot = calls.day === day ? ((calls as { by_bot?: Record<string, number> }).by_bot ?? {}) : {};
  const cfgs = await Promise.all(
    catalogs.map(async ({ bot }) => {
      let cfg: Map<string, unknown> | null = null;
      try {
        cfg = (await readConfig(bot.configPath)) as Map<string, unknown>;
      } catch {
        /* unreadable config */
      }
      const scope = String(cfg?.get("model.budget_scope") ?? "fleet");
      const weightRaw = cfg?.get("model.budget_weight");
      const weight = typeof weightRaw === "number" ? weightRaw : 1;
      const pool = Number(cfg?.get("model.fleet_token_budget") ?? 0);
      const own = Number(cfg?.get("model.daily_token_budget") ?? 0);
      const f = await flags(bot).catch(() => [] as string[]);
      const running = !f.includes("STOP") && !f.includes("PAUSE") && (await agentPids(bot.configPath, path.join(path.dirname(bot.configPath), "workspace", "explorer.pid")).catch(() => [])).length > 0;
      return { bot, scope, weight, pool, own, running, used: Number(byBot[bot.name] ?? 0) };
    }),
  );
  const pooled = cfgs.filter((c) => c.scope === "active");
  const poolSize = Math.max(0, ...pooled.map((c) => c.pool));
  if (poolSize > 0) {
    const usedAll = Object.values(byBot).reduce((t, v) => t + Number(v || 0), 0);
    const left = Math.max(0, poolSize - usedAll);
    const sharers = pooled.filter((c) => c.running && c.weight > 0);
    const totalW = sharers.reduce((t, c) => t + c.weight, 0);
    usageBars.push({
      group: "Bot daily budgets",
      label: "Fleet token pool",
      used: usedAll,
      limit: poolSize,
      detail: `${usedAll.toLocaleString()} of ${poolSize.toLocaleString()} tokens · shared by ${sharers.map((c) => c.bot.name).join(", ") || "no running bot"}`,
      resetsAt: next(localMidnight),
      resetNote: "daily, at midnight here",
    });
    for (const c of pooled) {
      if (!c.used && !(c.running && c.weight > 0)) continue;
      const share = c.running && c.weight > 0 && totalW > 0 ? c.weight / totalW : 0;
      const allowance = c.used + share * left;
      usageBars.push({
        group: "Bot daily budgets",
        label: c.bot.name,
        sub: true,
        used: c.used,
        limit: c.weight > 0 && share > 0 ? Math.round(allowance) : null,
        detail:
          c.weight <= 0
            ? `${c.used.toLocaleString()} tokens from the pool · never paced`
            : share > 0
              ? `${c.used.toLocaleString()} of ${Math.round(allowance).toLocaleString()} · ${Math.round(share * 100)}% share (weight ${c.weight})`
              : `${c.used.toLocaleString()} tokens · not sharing now (${c.running ? "weight 0" : "stopped"})`,
        resetsAt: next(localMidnight),
        resetNote: "its allowance = its tokens today + its share of what is left in the pool",
        badge: c.weight <= 0 ? "no pacing" : share > 0 ? undefined : "stopped",
      });
    }
  }
  for (const c of cfgs.filter((x) => x.scope === "bot" && (x.own > 0 || x.used > 0))) {
    usageBars.push({
      group: "Bot daily budgets",
      label: c.bot.name,
      used: c.used,
      limit: c.own > 0 ? c.own : null,
      detail: c.own > 0 ? `${c.used.toLocaleString()} of ${c.own.toLocaleString()} tokens (its own cap)` : `${c.used.toLocaleString()} tokens, no cap`,
      resetsAt: next(localMidnight),
      resetNote: "daily, at midnight here",
    });
  }

  const order: Record<KeyRow["available"], number> = { "not working": 0, paused: 1, limited: 2, ready: 3, "on file": 4, unused: 5, "no key": 6 };
  rows.sort((a, b) => order[a.available] - order[b.available] || Number(a.paid) - Number(b.paid) || a.name.localeCompare(b.name));
  const fleetTokens = Object.values(calls.day === day ? ((calls as { by_bot?: Record<string, number> }).by_bot ?? {}) : {}).reduce((t, v) => t + Number(v || 0), 0);
  const data = { fleetTokens, rows, usage: usageBars, watch, generatedAt: new Date().toISOString() };
  g.__keyOverview = { at: Date.now(), data };
  return data;
}
