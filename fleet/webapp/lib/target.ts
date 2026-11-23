// Server-side only: the family's target market, common-data/knowledge/target.toml (owner, 2026-09-30: "I might change
// target location in future. It should be said in task and goals, not in code"). The engine fills {market},
// {market_short}, {segment}, {trades} and {areas} in every bot's card from it, and the candidates feed reads `market`.
// Your own values live in common-data/local/family.toml [target] (git-ignored, so `git pull` never meets an
// edit); they sit on top of the tracked file, as they do for the engine. The Work plan page shows the five lines and
// saves them there; the tracked file is never written.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR } from "./bots";
import { readFamily, saveFamily } from "./family";

const FILE = path.join(BOTS_DIR, "common-data", "knowledge", "target.toml");
const TARGET_KEYS = ["market", "market_short", "segment", "trades", "areas"] as const;
type TargetKey = (typeof TARGET_KEYS)[number];
type Target = Record<TargetKey, string>;
const TARGET_MAX = 200;

const unquote = (v: string) => v.trim().replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, TARGET_MAX) : "");

export async function readTarget(): Promise<Target> {
  const out = Object.fromEntries(TARGET_KEYS.map((k) => [k, ""])) as Target;
  try {
    for (const line of (await readFile(/*turbopackIgnore: true*/ FILE, "utf8")).split("\n")) {
      const m = /^\s*([a-z_]+)\s*=\s*(".*")\s*(#.*)?$/.exec(line);
      if (m && (TARGET_KEYS as readonly string[]).includes(m[1])) out[m[1] as TargetKey] = unquote(m[2]);
    }
  } catch {
    /* no target file yet */
  }
  const own = (await readFamily())?.target ?? {};
  const mine = (k: TargetKey) => (typeof own[k] === "string" ? (own[k] as string).trim() : "");
  for (const k of TARGET_KEYS) if (mine(k)) out[k] = mine(k);
  // as the engine does: your market without a short name of its own gets one from the market, not the tracked file's
  if (mine("market") && !mine("market_short")) out.market_short = mine("market").split(",")[0].trim();
  return out;
}

/** Save the five values to family.toml [target] (the rest of the file kept). `market` may not be empty. */
export async function writeTarget(raw: unknown): Promise<Target> {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const next = Object.fromEntries(TARGET_KEYS.map((k) => [k, clean(r[k])])) as Target;
  if (!next.market) throw new Error("the market cannot be empty");
  const fam = (await readFamily()) ?? { company: {}, target: {}, team: [], other: {} };
  // an empty line is left out, not written as "": the tracked default (or, for market_short, the market) applies
  const target = { ...fam.target };
  for (const k of TARGET_KEYS) {
    if (next[k]) target[k] = next[k];
    else delete target[k];
  }
  // "where your customers are" is the market: the first-run answers follow the panel
  const company = typeof fam.company.place === "string" ? { ...fam.company, place: next.market } : fam.company;
  await saveFamily({ ...fam, company, target });
  return readTarget();
}

const FEEDS_FILE = path.join(BOTS_DIR, "common-data", "knowledge", "candidate-feeds.toml");

/** Markets that have a candidates feed (the [feeds."<market>"] tables of candidate-feeds.toml). A market without one
 * leaves Lead Gen on web search alone, which the Target panel says before the owner saves. */
export async function feedMarkets(): Promise<string[]> {
  try {
    const text = await readFile(/*turbopackIgnore: true*/ FEEDS_FILE, "utf8");
    return [...new Set([...text.matchAll(/^\s*\[feeds\."([^"]+)"\]\s*$/gm)].map((m) => m[1]))];
  } catch {
    return [];
  }
}

/** Fill {market}-style placeholders the way the engine does, for showing a card or goal as the agent reads it. */
export function fillTarget(text: string, t: Target): string {
  return text.replace(/\{(market|market_short|segment|trades|areas)\}/g, (all, k: TargetKey) => t[k] || all);
}
