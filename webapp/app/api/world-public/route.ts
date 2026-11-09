import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { shoulder } from "@/lib/board";
import { liveBoard } from "@/lib/board-read";
import { BOTS_DIR, findBot } from "@/lib/bots";
import { workspaceDir } from "@/lib/control";
import { dbPath } from "@/lib/episodes";
import { leaks, makeMasker, publicState, STATE_MAX_AGE_MS, type FeedOf, type Masker, type PublicState } from "@/lib/world-public";

// The public world's state: the Board and each member's Feed, masked by
// lib/world-public.ts. Read only by scripts/world-public.ts on this Mac (the dashboard's own access rules apply here as
// everywhere: loopback or the owner's tailnet); that server is what the funnel exposes, never this one.
const LEADS = path.join(BOTS_DIR, "common-data", "shared-state", "portal-leads-cache.json");
const TEAM = path.join(BOTS_DIR, "common-data", "team.json");

const g = globalThis as { __worldMask?: { key: string; mask: Masker }; __worldState?: { at: number; data: Promise<PublicState> } };

/** The masker, rebuilt when the leads cache or the team list changes. */
async function masker(): Promise<Masker> {
  const mt = async (p: string) => (await stat(/*turbopackIgnore: true*/ p).catch(() => null))?.mtimeMs ?? 0;
  const key = `${await mt(LEADS)}:${await mt(TEAM)}`;
  if (g.__worldMask?.key === key) return g.__worldMask.mask;
  const read = async (p: string) => JSON.parse(await readFile(/*turbopackIgnore: true*/ p, "utf8").catch(() => "{}")) as Record<string, unknown>;
  const [leads, team] = await Promise.all([read(LEADS), read(TEAM)]);
  const rows = Object.values((leads.rows ?? {}) as Record<string, { business?: string; contact_person?: string }>);
  const members = ((team.members ?? []) as { name?: string }[]).map((m) => String(m.name ?? ""));
  const mask = makeMasker({ leads: rows.map((r) => ({ business: r.business, contact: r.contact_person })), team: members });
  g.__worldMask = { key, mask };
  return mask;
}

async function build(): Promise<PublicState> {
  const [board, mask] = await Promise.all([liveBoard(), masker()]);
  const feeds: Record<string, FeedOf | null> = {};
  await Promise.all(
    board.cards.map(async (c) => {
      const bot = await findBot(c.slug);
      if (!bot) return;
      const s = await shoulder(await workspaceDir(bot), await dbPath(bot).catch(() => null), Date.now()).catch(() => null);
      feeds[c.slug] = s ? { thought: s.thought ?? null, feed: s.feed } : null;
    }),
  );
  return publicState({ board: board as unknown as Record<string, unknown>, web: null, feeds, trial: null, tick: null }, mask);
}

export async function GET() {
  try {
    const now = Date.now();
    if (!g.__worldState || now - g.__worldState.at > STATE_MAX_AGE_MS) {
      g.__worldState = { at: now, data: build() };
      g.__worldState.data.catch(() => (g.__worldState = undefined));
    }
    const data = await g.__worldState.data;
    // the last check: an address or a long number that slipped through stops the whole state, never goes out
    if (leaks(data)) return Response.json({ error: "the state still held an address or a number; not sent" }, { status: 500 });
    return new Response(JSON.stringify(data), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: `could not read the office: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
