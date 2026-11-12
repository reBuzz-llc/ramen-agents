// The owner's private chat with one agent (creatorCC queue 34; owner, 10-31: "old chat was too busy; create a new one
// with minimal msgs"): only what the owner wrote to this agent and what it wrote back.
//   common-data/shared-state/owner-chat/<slug>.jsonl, one line per message {ts, from: "Owner" | "<bot name>", text}.
//   This app appends the owner's lines; the engine appends the bot's replies (its `message` action to "Owner").
// The owner's line also goes to the bot's inbox as <ws>/inbox/<YYYY-MM-DD-HHMMSS>-owner.json, in the shape the bots'
// handoff.send_message writes ({from, kind: "message", sent_at, text}); the bot reads it on its next step and files it
// to inbox/done/. Every write is whole: the chat line is one append of the full line (O_APPEND), the inbox file a temp
// file renamed into place (the inbox reads only *.json). Node imports only, so the test runs with Node's own runner.
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type ChatLine = { ts: string; from: string; text: string };
export const MAX_CHAT = 500;

function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** The lines of a chat file, oldest first, the last `limit`; a torn or malformed line is skipped. */
export function parseChat(text: string, limit = 100): ChatLine[] {
  const out: ChatLine[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      if (typeof o.ts === "string" && typeof o.from === "string" && typeof o.text === "string") out.push({ ts: o.ts, from: o.from, text: o.text });
    } catch {
      /* a line still being written */
    }
  }
  return out.slice(-limit);
}

export async function readChat(file: string, limit = 100): Promise<ChatLine[]> {
  return parseChat(await readFile(/*turbopackIgnore: true*/ file, "utf8").catch(() => ""), limit);
}

/** The owner's text as one line: newlines become spaces, trimmed; null when empty or longer than 500 characters. */
export function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s*[\r\n]+\s*/g, " ").trim();
  return t && t.length <= MAX_CHAT ? t : null;
}

const exists = (p: string) => stat(/*turbopackIgnore: true*/ p).then(() => true, () => false);

/** Post the owner's line: append it to the chat file, then drop the message into the bot's inbox. */
export async function postChat(o: { chatFile: string; ws: string; text: string; now?: number }): Promise<{ line: ChatLine; inbox: string }> {
  const ts = localIso(o.now ?? Date.now());
  const line: ChatLine = { ts, from: "Owner", text: o.text };
  await mkdir(/*turbopackIgnore: true*/ path.dirname(o.chatFile), { recursive: true });
  await appendFile(/*turbopackIgnore: true*/ o.chatFile, JSON.stringify(line) + "\n", { flag: "a" });
  const inboxDir = path.join(o.ws, "inbox");
  await mkdir(/*turbopackIgnore: true*/ inboxDir, { recursive: true });
  const stamp = ts.replace("T", "-").replace(/:/g, "");
  let file = path.join(inboxDir, `${stamp}-owner.json`);
  for (let n = 2; await exists(file); n++) file = path.join(inboxDir, `${stamp}-owner-${n}.json`); // two in one second
  const tmp = path.join(inboxDir, `.${path.basename(file)}.${process.pid}.tmp`);
  await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify({ from: "Owner", kind: "message", sent_at: ts, text: o.text }, null, 1));
  await rename(tmp, file);
  return { line, inbox: file };
}

/** The time of the agent's last line in a chat, for the unread dot; null when it never answered, or when the owner wrote
 *  after it (the owner writes from the open Chat tab, so has seen it). */
export function lastReplyTs(lines: ChatLine[]): string | null {
  const last = lines[lines.length - 1];
  return last && last.from !== "Owner" ? last.ts : null;
}

/** Each agent's last reply time, from shared-state/owner-chat/<slug>.jsonl (queue 35: the unread marker). */
export async function latestReplies(dir: string, slugs: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  await Promise.all(slugs.map(async (s) => (out[s] = lastReplyTs(await readChat(path.join(dir, `${s}.jsonl`), 500)))));
  return out;
}

/** Each chat's last line from the owner and from the agent (queue 40: a paper plane down to the agent when the owner
 *  writes, up out of the scene when it answers). */
export async function chatTimes(dir: string, slugs: string[]): Promise<Record<string, { owner: string | null; agent: string | null }>> {
  const out: Record<string, { owner: string | null; agent: string | null }> = {};
  await Promise.all(
    slugs.map(async (s) => {
      const lines = await readChat(path.join(dir, `${s}.jsonl`), 500);
      const last = (owner: boolean) => [...lines].reverse().find((l) => (l.from === "Owner") === owner)?.ts ?? null;
      out[s] = { owner: last(true), agent: last(false) };
    }),
  );
  return out;
}
