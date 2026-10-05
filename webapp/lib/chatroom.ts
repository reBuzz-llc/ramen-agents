// Server-side only: the shared fleet chatroom log (common-data/chatroom.jsonl), which the bots write
// to (src/explorer/chatroom.py) when they post a `message` to "everyone". Read-only here — the webapp
// shows the room; the bots are the ones talking. One JSON object per line; a torn last line is skipped.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR } from "./bots";

// kind: "post" = a bot talking; "report" = the controller noting that a bot acted on a handoff (lead listed,
// package handed/published, task created); "receipt" = a bot read its inbox. seenBy: bots whose room cursor is past
// this line (chatroom-seen.json), so the owner can tell a post was received. Bots themselves only read "post".
export type RoomPost = { id: number; ts: string; sender: string; text: string; kind: "post" | "report" | "receipt"; seenBy: string[] };

const ROOM_FILE = path.join(BOTS_DIR, "common-data", "chatroom.jsonl");

const SEEN_FILE = path.join(BOTS_DIR, "common-data", "chatroom-seen.json");

/** Who has read the room how far: bot name -> last line id it has seen (written by each bot's controller). */
export async function readRoomSeen(): Promise<Record<string, { last_id: number; ts: string }>> {
  try {
    const raw = JSON.parse(await readFile(/*turbopackIgnore: true*/ SEEN_FILE, "utf8")) as Record<string, { last_id?: number; ts?: string }>;
    const out: Record<string, { last_id: number; ts: string }> = {};
    for (const [bot, v] of Object.entries(raw)) if (typeof v?.last_id === "number") out[bot] = { last_id: v.last_id, ts: String(v.ts ?? "") };
    return out;
  } catch {
    return {};
  }
}

export async function readRoom(limit = 200): Promise<RoomPost[]> {
  let text: string;
  try {
    text = await readFile(/*turbopackIgnore: true*/ ROOM_FILE, "utf8");
  } catch {
    return []; // no room file yet: no one has posted
  }
  const out: RoomPost[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    try {
      const d = JSON.parse(line) as { ts?: string; sender?: string; text?: string; kind?: string };
      const kind = d.kind === "report" || d.kind === "receipt" ? d.kind : "post";
      if (d.text) out.push({ id: i, ts: String(d.ts ?? ""), sender: String(d.sender ?? ""), text: String(d.text), kind, seenBy: [] });
    } catch {
      /* a line torn by a concurrent append; skip it */
    }
  });
  const seen = await readRoomSeen();
  const posts: RoomPost[] = out.slice(-limit);
  for (const p of posts) {
    if (p.kind !== "post") continue;
    p.seenBy = Object.entries(seen).filter(([bot, v]) => v.last_id >= p.id && bot.toLowerCase() !== (p.sender || "").toLowerCase()).map(([bot]) => bot).sort();
  }
  return posts;

}
