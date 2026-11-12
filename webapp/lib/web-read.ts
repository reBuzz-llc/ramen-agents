// Server-side only: the family's web activity for the world's WEB terminal (queue 33) and its floating screens (queue
// 39), polled every 12 s like the board and shared for 5 s. The running bots are the board's cards
// (lib/board-read.ts); each one's database gives one query (lib/board.ts webSql). Each read also files the bots' fresh
// screenshots into the pictures' ring (lib/web-shots.ts) and gives each recent page the picture of its visit, if any.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDenylist, validPage, webData, webRow, type WebData } from "./board";
import { liveBoard } from "./board-read";
import { BOTS_DIR, listBots } from "./bots";
import { workspaceDir } from "./control";
import { dbPath } from "./episodes";
import { ringFiles, shotFor, syncRing } from "./web-shots";

export const SHOTS_DIR = path.join(BOTS_DIR, "common-data", "shared-state", "web-shots");

const CACHE_MS = 5000;
const g = globalThis as { __web?: { at: number; data: Promise<WebData> } };

async function read(): Promise<WebData> {
  const now = Date.now();
  const [board, bots] = await Promise.all([liveBoard(), listBots()]);
  const running = board.cards.map((c) => ({ c, bot: bots.find((b) => b.slug === c.slug) }));
  const deny = parseDenylist(await readFile(/*turbopackIgnore: true*/ path.join(BOTS_DIR, "common-data", "denylist.txt"), "utf8").catch(() => ""));
  const rows = await Promise.all(
    running.map(async ({ c, bot }) => ({ slug: c.slug, name: c.name, ws: bot ? await workspaceDir(bot) : "", row: bot ? await webRow(await dbPath(bot).catch(() => null), now) : null })),
  );
  // each bot's latest valid page: its current picture belongs to the ring when taken just after it
  const lastValid = (row: Record<string, unknown> | null) => {
    let recent: { ts: string; t: string; p: string | null; v: string; r: string | null }[] = [];
    try {
      recent = typeof row?.recent === "string" ? JSON.parse(row.recent) : [];
    } catch {
      /* none */
    }
    return recent.find((r) => validPage(r, deny))?.ts ?? null;
  };
  await syncRing(SHOTS_DIR, rows.filter((r) => r.ws).map((r) => ({ slug: r.slug, ws: r.ws, lastValid: lastValid(r.row) }))).catch(() => undefined);
  const ring = await ringFiles(SHOTS_DIR);
  const data = webData(rows, now, deny);
  for (const p of data.recent_pages) {
    const f = shotFor(ring, p);
    if (f) p.shot = `/api/web/shot/${f}`;
  }
  return data;
}

export function liveWeb(): Promise<WebData> {
  if (g.__web && Date.now() - g.__web.at < CACHE_MS) return g.__web.data;
  const data = read();
  g.__web = { at: Date.now(), data };
  data.catch(() => (g.__web = undefined));
  return data;
}
