// Server-side only: the whole fleet over a period, for the Summary tab's "All bots" view. Each bot's own
// database (read-only, as lib/summary.ts), its live state from its data server, and the relation map:
// which bot hands work to which (config [handoff] and [[messaging.peers]]) and how much actually moved
// through those channels in the period (the sender's `package` and `message` actions), plus the owner's
// chat, tasks sent to Notion and AI providers recorded by the Scout.
import { readFile } from "node:fs/promises";
import type { BotProfile } from "./bot";
import { readConfig } from "./bots";

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** [[messaging.peers]] tables (name + folder). readToml keeps only plain [sections], so these are read here. */
function peersOf(text: string): { name: string; folder: string }[] {
  const out: { name: string; folder: string }[] = [];
  const blocks = text.split(/^\s*\[\[messaging\.peers\]\]\s*$/m).slice(1);
  for (const block of blocks) {
    const body = block.split(/^\s*\[/m)[0];
    const name = body.match(/^\s*name\s*=\s*"([^"]*)"/m)?.[1];
    const folder = body.match(/^\s*folder\s*=\s*"([^"]*)"/m)?.[1];
    if (name && folder) out.push({ name, folder });
  }
  return out;
}

type Channels = { handoff: { toName: string; toFolder: string } | null; messaging: { name: string; folder: string }[] };

export async function channels(bot: BotProfile): Promise<Channels> {
  const cfg = await readConfig(bot.configPath);
  const own = await readFile(/*turbopackIgnore: true*/ bot.configPath, "utf8");
  const handoff =
    cfg.get("handoff.enabled") === true && typeof cfg.get("handoff.to_folder") === "string"
      ? { toName: str(cfg.get("handoff.to_name")), toFolder: str(cfg.get("handoff.to_folder")) }
      : null;
  return { handoff, messaging: cfg.get("messaging.enabled") === true ? peersOf(own) : [] };
}

