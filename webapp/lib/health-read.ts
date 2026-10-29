// Reads the files behind the health banner (lib/health.ts holds the checks) for the dashboard: the Validator's
// state.json, `last reboot shutdown`, and each running bot's accepted actions and explorer.jsonl. Read-only, cached a
// minute, like the family review.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR, listBots } from "./bots";
import { workspaceDir } from "./control";
import { lastOutput, jsonlTexts, offSpans, parseLast } from "./downtime";
import { dbPath } from "./episodes";
import { lastActionBefore } from "./family-review";
import { query } from "./family-stats";
import { idleIssue, rebootIssue, restIntervals, validatorIssue, type Issue } from "./health";

const CACHE_MS = 60 * 1000;
const g = globalThis as { __health?: { at: number; issues: Issue[] } };
const VALIDATOR_STATE = path.join(BOTS_DIR, "validator", "workspace", "state.json");

async function running() {
  const bots = await listBots();
  const all = await Promise.all(
    bots.map(async (bot) => {
      const ws = await workspaceDir(bot);
      if (await stat(path.join(ws, "STOP")).then(() => true, () => false)) return null;
      return { bot, logs: path.join(ws, "logs"), db: await dbPath(bot).catch(() => null) };
    }),
  );
  return all.filter((x) => x !== null);
}

export async function health(): Promise<Issue[]> {
  if (g.__health && Date.now() - g.__health.at < CACHE_MS) return g.__health.issues;
  const now = Date.now();
  const from7 = now - 7 * 86400e3;
  const [bots, stateText, lastText] = await Promise.all([running(), readFile(VALIDATOR_STATE, "utf8").catch(() => "{}"), lastOutput()]);
  const before = lastActionBefore(bots.map((b) => b.db).filter((d): d is string => !!d));
  const off = await offSpans(parseLast(lastText, now), from7, now, before);
  const off24 = off.filter((s) => new Date(s.to).getTime() > now - 86400e3);
  const offIv = off.map((s): [number, number] => [new Date(s.from).getTime(), new Date(s.to).getTime()]);
  const idle = await Promise.all(
    bots.map(async (b) => {
      if (!b.db) return null;
      const [r] = await query(b.db, "SELECT MAX(ts) AS t FROM actions WHERE verdict LIKE 'allowed%'").catch(() => []);
      const last = typeof r?.t === "string" ? r.t : null;
      if (!last) return null;
      const texts = await jsonlTexts(b.logs, Math.max(from7, new Date(last).getTime() - 86400e3));
      return idleIssue(b.bot.name, last, restIntervals(texts.join("\n"), now), offIv, now);
    }),
  );
  const issues = [validatorIssue(stateText, now), rebootIssue(off24), ...idle].filter((x): x is Issue => x !== null);
  g.__health = { at: now, issues };
  return issues;
}
