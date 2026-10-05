// Server-side only: talk to one bot through its data server's chat (`bot --config <config> dashboard`).
//
// The data server keeps the conversation in the bot's database (table `chat`) and answers a plain message
// with the bot's model, using its notes, questions and journal as context; the running agent also sees the
// message on its next cycle as "Owner says". Slash commands (/ask, /interest, /pause, /resume, /stop, /help)
// are handled by code there, not by the model. Writes need the token the data server writes to
// workspace/dashboard.token when it starts; it is read here, on the server, and never sent to the browser.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BotProfile } from "./bot";
import { dataServerUrl } from "./bots";
import { workspaceDir } from "./control";

export const MAX_MESSAGE_CHARS = 2000;

export type ChatMessage = { id: number; ts: string; role: "owner" | "bot" | "system"; text: string; seen: number };
export type ChatReply = { reply?: string; kind?: "model" | "command"; error?: string };

export class ChatOffline extends Error {}

async function token(bot: BotProfile): Promise<string> {
  try {
    return (await readFile(/*turbopackIgnore: true*/ path.join(await workspaceDir(bot), "dashboard.token"), "utf8")).trim();
  } catch {
    throw new ChatOffline(`${bot.name}'s data server is not running (no dashboard.token), so there is no one to chat with.`);
  }
}

export async function readChat(bot: BotProfile, limit = 200): Promise<ChatMessage[]> {
  let res: Response;
  try {
    res = await fetch(dataServerUrl(bot, "/api/chat"), { cache: "no-store", signal: AbortSignal.timeout(8000) });
  } catch {
    throw new ChatOffline(`Could not reach ${bot.name}'s data server on port ${bot.port}.`);
  }
  if (!res.ok) throw new Error(`data server answered HTTP ${res.status}`);
  const rows = (await res.json()) as ChatMessage[];
  return Array.isArray(rows) ? rows.slice(-limit) : [];
}

/** Send one message. A model reply can take a while on the local model, so the wait is long. */
export async function sendChat(bot: BotProfile, text: string): Promise<{ status: number; body: ChatReply }> {
  const key = await token(bot);
  let res: Response;
  try {
    res = await fetch(dataServerUrl(bot, "/api/chat"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-token": key },
      body: JSON.stringify({ text }),
      cache: "no-store",
      signal: AbortSignal.timeout(240_000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new ChatOffline(
      timedOut
        ? `${bot.name} took too long to answer. The message is saved; the reply may still appear.`
        : `Could not reach ${bot.name}'s data server on port ${bot.port}.`,
    );
  }
  const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as ChatReply;
  return { status: res.status, body };
}
