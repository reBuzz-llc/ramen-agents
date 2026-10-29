// The family review (creatorCC builds this table by hand each review; owner, 2026-10-28): per running bot, its actions,
// refusals, accepted outputs, last action, plan in hand and crashes, for the last 7 days and 24 hours; then the
// Validator's refusal report and the team's sending. Read-only; one read per bot, side by side, cached a minute.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { BotProfile } from "./bot";
import { BOTS_DIR, listBots } from "./bots";
import { workspaceDir } from "./control";
import { dbPath } from "./episodes";
import { downtime, jsonlTexts, lastOutput, type Downtime } from "./downtime";
import { awakeMinutes, providerStrip, type Provider } from "./health";
import { actionStats, agoWords, crashesOf, lastOwnOutput, localIso, OWN_OUTPUT, parseOkr, planSummary, query, type BotStats, type Okr, type PlanSummary } from "./family-stats";
import { leadResults } from "./lead-results";

/** The last accepted output of the bot's own kind; `late` when over 24 h old and the Mac was on and the bots not quiet
 *  for most of that time. */
export type LastOutput = { label: string; at: string | null; ago: string; late: boolean } | null;
export type FamilyRow = { slug: string; name: string; handle: string; stats: BotStats | null; plan: PlanSummary; output: LastOutput; error: string };
export type FamilyReview = {
  at: string;
  rows: FamilyRow[];
  report: string; // the Validator's refusal-report.md, as written
  down: { w24: Downtime; w7: Downtime }; // Mac off and bots quiet, so a low day is not read as bad bots
  okr: Okr | null; // this week's objective and key results with the Validator's progress lines
  providers: Provider[]; // today's model providers, most calls first, with the engine's health dot
};
export type TeamNumbers = { ready: boolean; reason: string; sent: number; unsent: number | null; repliesWeek: number };

/** The team's sending, from the Leads board (cached ten minutes by leadResults): streamed apart from the table, since a
 *  cold read of the board takes a few seconds. */
export async function teamNumbers(): Promise<TeamNumbers> {
  const leads = await leadResults().catch(() => null);
  return leads
    ? { ready: leads.ready, reason: leads.reason, sent: leads.sending.sent, unsent: leads.drafts?.unsent ?? null, repliesWeek: leads.sending.repliesWeek }
    : { ready: false, reason: "The Leads board could not be read.", sent: 0, unsent: null, repliesWeek: 0 };
}

const CACHE_MS = 60 * 1000;
const g = globalThis as { __familyReview?: { at: number; data: FamilyReview } };

async function exists(p: string) {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}

type Read = { row: FamilyRow; db: string | null; logs: string };

async function rowOf(bot: BotProfile, now: number): Promise<Read | null> {
  const ws = await workspaceDir(bot);
  // A bot the owner stopped (STOP file) is not under review.
  if (await exists(path.join(ws, "STOP"))) return null;
  const base = { slug: bot.slug, name: bot.name, handle: bot.handle ?? "" };
  const db = await dbPath(bot).catch(() => null);
  const logs = path.join(ws, "logs");
  const own = OWN_OUTPUT[bot.slug];
  const [stats, crashes, plan, outAt] = await Promise.all([
    Promise.resolve(db)
      .then((p) => (p ? actionStats(p, now) : Promise.reject(new Error("no database"))))
      .then((v) => ({ ok: true as const, v }), (err: unknown) => ({ ok: false as const, err: err instanceof Error ? err.message.split("\n")[0] : String(err) })),
    crashesOf(logs, now),
    readFile(path.join(ws, "plan.json"), "utf8").then((t) => planSummary(JSON.parse(t)), () => null),
    own && db ? lastOwnOutput(db, bot.slug).catch(() => null) : Promise.resolve(null),
  ]);
  // Ageing ("late") needs the downtime spans: filled in by familyReview.
  const output: LastOutput = own ? { label: own.label, at: outAt, ago: outAt ? agoWords(outAt, now) : "none yet", late: false } : null;
  if (!stats.ok) return { row: { ...base, stats: null, plan, output, error: stats.err }, db, logs };
  return { row: { ...base, stats: { ...stats.v, crashes }, plan, output, error: "" }, db, logs };
}

/** The latest action any running bot logged before a time (ms), for a Mac-off gap with no clean shutdown. */
export function lastActionBefore(dbs: string[]) {
  return async (ms: number): Promise<number | null> => {
    const iso = localIso(ms);
    const found = await Promise.all(dbs.map((db) => query(db, `SELECT MAX(ts) AS t FROM actions WHERE ts < '${iso}'`).then((r) => r[0]?.t, () => null)));
    const best = found.filter((t): t is string => typeof t === "string").sort().pop();
    return best ? new Date(best).getTime() : null;
  };
}

/** Mac off and bots quiet in the last 24 hours and 7 days. Quiet comes from the running bot whose log was written last:
 *  all bots pause together. */
async function downtimes(reads: Read[], now: number): Promise<{ w24: Downtime; w7: Downtime }> {
  const from7 = now - 7 * 86400e3;
  const newest = await Promise.all(reads.map((r) => stat(path.join(r.logs, "explorer.jsonl")).then((s) => ({ r, at: s.mtimeMs }), () => null)));
  const pick = newest.filter((x) => x !== null).sort((a, b) => b.at - a.at)[0]?.r;
  const [last, texts] = await Promise.all([lastOutput(), pick ? jsonlTexts(pick.logs, from7) : Promise.resolve([])]);
  const before = lastActionBefore(reads.map((r) => r.db).filter((d): d is string => !!d));
  const [w24, w7] = await Promise.all([downtime(last, texts, now - 86400e3, now, before), downtime(last, texts, from7, now, before)]);
  return { w24, w7 };
}

export async function familyReview(fresh = false): Promise<FamilyReview> {
  if (!fresh && g.__familyReview && Date.now() - g.__familyReview.at < CACHE_MS) return g.__familyReview.data;
  const now = Date.now();
  const bots = await listBots();
  const [reads, report, okr, providers] = await Promise.all([
    Promise.all(bots.map((b) => rowOf(b, now))).then((r) => r.filter((x): x is Read => x !== null)),
    readFile(path.join(BOTS_DIR, "common-data", "shared-state", "refusal-report.md"), "utf8").catch(() => ""),
    readFile(path.join(BOTS_DIR, "common-data", "botBox", "routed", "the-ceo", "okr-week.md"), "utf8").then(parseOkr, () => null),
    readFile(path.join(BOTS_DIR, "common-data", "shared-state", "model_calls.json"), "utf8").then(providerStrip, () => []),
  ]);
  const down = await downtimes(reads, now);
  // Mac off and quiet in the last 7 days don't count against a bot's last output.
  const away = [...down.w7.off, ...down.w7.quiet].map((s): [number, number] => [new Date(s.from).getTime(), new Date(s.to).getTime()]);
  const rows = reads.map((r) => {
    const o = r.row.output;
    if (!o) return r.row;
    const since = o.at ? new Date(o.at).getTime() : now - 7 * 86400e3;
    const ageMin = (now - since) / 60e3;
    const late = ageMin > 24 * 60 && awakeMinutes(since, now, away) > ageMin / 2;
    return { ...r.row, output: { ...o, late } };
  });
  const data: FamilyReview = {
    at: new Date(now).toISOString(),
    rows: rows.sort((a, b) => (b.stats?.w24.refusedShare ?? 0) - (a.stats?.w24.refusedShare ?? 0)),
    report,
    down,
    okr,
    providers,
  };
  g.__familyReview = { at: now, data };
  return data;
}
