// Server-side only: where a bot's workspace is and which of its STOP and PAUSE flags are set. Starting and stopping
// a bot is the owner's, from the world (lib/owner-controls.ts).

import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { BotProfile } from "./bot";
import { readConfig } from "./bots";
import { agentPids } from "./processes";

export { agentPids };

async function exists(p: string): Promise<boolean> {
  try {
    await stat(/*turbopackIgnore: true*/ p);
    return true;
  } catch {
    return false;
  }
}

/** The bot's workspace folder: [paths] workspace, relative to the config file (src/explorer/config.py). */
export async function workspaceDir(bot: BotProfile): Promise<string> {
  let rel = "workspace";
  try {
    const v = (await readConfig(bot.configPath)).get("paths.workspace");
    if (typeof v === "string" && v.trim()) rel = v;
  } catch {
    /* default */
  }
  return path.resolve(path.dirname(bot.configPath), rel.replace(/^~(?=\/)/, homedir()));
}

export async function flags(bot: BotProfile): Promise<string[]> {
  const ws = await workspaceDir(bot);
  const out: string[] = [];
  if (await exists(path.join(ws, "PAUSE"))) out.push("PAUSE");
  if (await exists(path.join(ws, "STOP"))) out.push("STOP");
  return out;
}
