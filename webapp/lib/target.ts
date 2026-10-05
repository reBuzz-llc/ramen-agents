// Server-side only: the family's target market, common-data/knowledge/target.toml (owner, 2026-09-30: "I might change
// target location in future. It should be said in task and goals, not in code"). The engine fills {market},
// {market_short}, {segment}, {trades} and {areas} in every bot's card from it, and the candidates feed reads `market`.
// The Work plan page shows and edits the five lines; the file's comments are kept, only the value lines change.
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR } from "./bots";

const FILE = path.join(BOTS_DIR, "common-data", "knowledge", "target.toml");
export const TARGET_KEYS = ["market", "market_short", "segment", "trades", "areas"] as const;
export type TargetKey = (typeof TARGET_KEYS)[number];
export type Target = Record<TargetKey, string>;
export const TARGET_MAX = 200;

const unquote = (v: string) => v.trim().replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
  return out;
}

/** Save the five values in place (comments and order kept; a missing key is appended). `market` may not be empty. */
export async function writeTarget(raw: unknown): Promise<Target> {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const next = Object.fromEntries(TARGET_KEYS.map((k) => [k, clean(r[k])])) as Target;
  if (!next.market) throw new Error("the market cannot be empty");
  let text = "";
  try {
    text = await readFile(/*turbopackIgnore: true*/ FILE, "utf8");
  } catch {
    text = "# The market the family is working right now (edited on the Work plan page).\n";
  }
  const seen = new Set<string>();
  const lines = text.split("\n").map((line) => {
    const m = /^(\s*)([a-z_]+)(\s*=\s*)".*"(\s*#.*)?$/.exec(line);
    if (!m || !(TARGET_KEYS as readonly string[]).includes(m[2])) return line;
    seen.add(m[2]);
    return `${m[1]}${m[2]}${m[3]}${quote(next[m[2] as TargetKey])}${m[4] ?? ""}`;
  });
  for (const k of TARGET_KEYS) if (!seen.has(k)) lines.push(`${k} = ${quote(next[k])}`);
  const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmp, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o644 });
  await rename(tmp, FILE);
  return next;
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
