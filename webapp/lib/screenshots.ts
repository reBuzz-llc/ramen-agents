// Server-side only: a short history of each bot's screenshots, for Previous / Next on the dashboard.
//
// The bot keeps a single picture, workspace/screenshots/current.png, and replaces it (atomic rename) every
// time it draws a page (src/explorer/controller.py `_snapshot`). This app copies each new version into
// workspace/screenshots/history/ with the page address it showed, and keeps the newest MAX of them.
// The archiver runs while this app's server runs (instrumentation.ts starts it); pictures the bot took while
// the app was down are not recovered, since the bot itself never kept them.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BotProfile } from "./bot";
import { fetchState, listBots } from "./bots";
import { workspaceDir } from "./control";

export const MAX_HISTORY = Math.max(1, Number(process.env.SCREENSHOT_HISTORY_MAX) || 50);
const POLL_MS = 3000;
const BOTS_REFRESH_MS = 60000;
export const SHOT_ID = /^\d{8}T\d{9}-[0-9a-f]{8}$/;

export type ScreenshotItem = { id: string; at: string; url: string | null };
export type ScreenshotList = { max: number; currentMtimeMs: number | null; latestId: string | null; items: ScreenshotItem[] };

type Seen = { mtimeMs: number; hash: string | null };
const seen = new Map<string, Seen>();

async function dirs(bot: BotProfile) {
  const shots = path.join(await workspaceDir(bot), "screenshots");
  return { current: path.join(shots, "current.png"), history: path.join(shots, "history") };
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`;
}

async function historyIds(historyDir: string): Promise<string[]> {
  try {
    return (await readdir(/*turbopackIgnore: true*/ historyDir))
      .filter((f) => f.endsWith(".png") && SHOT_ID.test(f.slice(0, -4)))
      .map((f) => f.slice(0, -4))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

async function currentUrl(bot: BotProfile): Promise<string | null> {
  return (await fetchState(bot, 1500))?.heartbeat?.current_url ?? null;
}

/** Copy current.png into the history if it changed since the last look. Safe to call often. */
export async function archiveBot(bot: BotProfile): Promise<void> {
  const { current, history } = await dirs(bot);
  let mtimeMs: number;
  try {
    const st = await stat(/*turbopackIgnore: true*/ current);
    if (st.size === 0) return;
    mtimeMs = st.mtimeMs;
  } catch {
    return; // no picture right now (a text-only page, or the bot has not drawn one)
  }
  const last = seen.get(bot.slug);
  if (last && last.mtimeMs === mtimeMs) return;

  const data = await readFile(/*turbopackIgnore: true*/ current);
  const hash = createHash("sha1").update(data).digest("hex").slice(0, 8);
  const ids = await historyIds(history);
  // After a restart of this app, the newest saved picture tells whether this one is already archived.
  const lastHash = last?.hash ?? (ids[0] ? ids[0].slice(-8) : null);
  seen.set(bot.slug, { mtimeMs, hash });
  if (hash === lastHash) return;

  // Read the page address now, while it most likely still matches the picture.
  // A picture found when this app starts may be old, and the bot's page has moved on: no address then.
  const url = Date.now() - mtimeMs < 60000 ? await currentUrl(bot) : null;
  await mkdir(/*turbopackIgnore: true*/ history, { recursive: true });
  const id = `${stamp(mtimeMs)}-${hash}`;
  await writeFile(/*turbopackIgnore: true*/ path.join(history, `${id}.png`), data);
  await writeFile(/*turbopackIgnore: true*/ path.join(history, `${id}.json`), JSON.stringify({ at: new Date(mtimeMs).toISOString(), url }));

  for (const old of [id, ...ids].slice(MAX_HISTORY)) {
    await rm(/*turbopackIgnore: true*/ path.join(history, `${old}.png`), { force: true });
    await rm(/*turbopackIgnore: true*/ path.join(history, `${old}.json`), { force: true });
  }
}

export async function listScreenshots(bot: BotProfile): Promise<ScreenshotList> {
  await archiveBot(bot).catch(() => undefined);
  const { current, history } = await dirs(bot);
  let currentMtimeMs: number | null = null;
  try {
    currentMtimeMs = (await stat(/*turbopackIgnore: true*/ current)).mtimeMs;
  } catch {
    /* none */
  }
  const ids = await historyIds(history);
  const items = await Promise.all(
    ids.map(async (id): Promise<ScreenshotItem> => {
      try {
        const meta = JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(history, `${id}.json`), "utf8")) as { at?: string; url?: string | null };
        return { id, at: meta.at ?? "", url: meta.url ?? null };
      } catch {
        return { id, at: "", url: null };
      }
    }),
  );
  // The newest history entry is the live picture when it was copied from the current file.
  const latestId = currentMtimeMs !== null && ids[0]?.startsWith(stamp(currentMtimeMs)) ? ids[0] : null;
  return { max: MAX_HISTORY, currentMtimeMs, latestId, items };
}

export async function readScreenshot(bot: BotProfile, id: string): Promise<Buffer | null> {
  if (!SHOT_ID.test(id)) return null;
  try {
    return await readFile(/*turbopackIgnore: true*/ path.join((await dirs(bot)).history, `${id}.png`));
  } catch {
    return null;
  }
}

/** Poll every bot's current.png while the server runs. Started once from instrumentation.ts. */
export function startScreenshotArchiver(): void {
  const g = globalThis as { __screenshotArchiver?: boolean };
  if (g.__screenshotArchiver) return;
  g.__screenshotArchiver = true;

  let bots: BotProfile[] = [];
  let botsAt = 0;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (Date.now() - botsAt > BOTS_REFRESH_MS) {
        bots = await listBots();
        botsAt = Date.now();
      }
      for (const bot of bots) await archiveBot(bot).catch(() => undefined);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), POLL_MS).unref();
}
