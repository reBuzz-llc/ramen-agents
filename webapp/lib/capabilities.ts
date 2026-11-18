// Server-side only: what an agent can and cannot do, read from its config (owner, 2026-09-26: "how do I know a rule
// fits what the agent can actually do?"). Shown on the back of its Work plan card, so a goal or rule can be checked
// against the agent's real skills before it is saved. Every line comes from a config key, so it cannot drift.
import path from "node:path";
import type { BotProfile } from "./bot";
import { readConfig } from "./bots";
import { flags } from "./control";
import { channels } from "./fleet";
import { readTarget } from "./target";

export type Capabilities = { state: string; can: string[]; cannot: string[] };

// The fence every agent works inside, whatever its config says (the engine's policy, and the family card).
const NEVER = [
  "Create accounts, sign up, or make API keys",
  "Spend money or use a paid service",
  "Handle personal data or contact anyone outside the family",
  "Change its own code or copy itself",
];

export async function capabilitiesOf(bot: BotProfile): Promise<Capabilities> {
  const cfg = await readConfig(bot.configPath);
  const on = (k: string) => cfg.get(k) === true;
  const num = (k: string) => (typeof cfg.get(k) === "number" ? (cfg.get(k) as number) : null);
  const can: string[] = [];
  const cannot: string[] = [];

  const stopped = (await flags(bot)).includes("STOP");
  const local = cfg.get("model.provider") === "ollama" && cfg.get("model.remote_for") !== "all";

  // How it works.
  can.push("Browse the web and use keyless search (SearXNG and friends)");
  cannot.push("Use Google or paid search APIs directly");
  if (local) can.push("Think with a model on this Mac");

  // Outputs.
  // the boards (queue 572: the dashboard's local board, or the hosted portal): [tasks], [packages] and [leads]
  if (on("tasks.enabled")) {
    const cap = num("tasks.max_per_day");
    can.push(`Create tasks on your Tasks board${cap ? ` (up to ${cap} a day)` : ""}; a person moves their status`);
  }
  if (on("packages.enabled")) can.push("Hand packages over to your Packages page as drafts; a person prices and publishes them");
  if (on("leads.enabled")) {
    const cap = num("leads.max_per_day");
    can.push(`Add and fix rows on the Leads board${cap ? ` (up to ${cap} a day)` : ""}${on("leads.update_any_row") ? ", any row" : ", its own rows"}`);
  }
  if (!on("tasks.enabled") && !on("packages.enabled") && !on("leads.enabled")) cannot.push("Write to the boards (no Tasks, Packages or Leads)");
  if (on("site_gate.enabled")) {
    const t = await readTarget(); // the target lives in target.toml, never in code (owner, 2026-09-30)
    can.push(`Reads the own websites of ${t.market || "the target market"}'s ${t.segment || "businesses"}; skips directories and articles`);
  }
  const ch = await channels(bot).catch(() => ({ handoff: null, messaging: [] as { name: string }[] }));
  if (ch.handoff) can.push(`Hand designed packages to ${ch.handoff.toName || path.basename(ch.handoff.toFolder)}`);
  if (on("scout.enabled")) can.push("Record free AI provider finds for you to review");
  if (on("publish.enabled")) can.push("Publish its journal to its GitHub page");

  // Talking.
  if (on("messaging.enabled")) {
    const names = ch.messaging.map((p) => p.name);
    can.push(`Message ${names.length ? names.join(", ") : "no one yet"}${on("messaging.plain_only") ? " (one plain line, no links)" : ""}`);
    if (on("messaging.room")) can.push("Post in the fleet chatroom");
  } else cannot.push("Message other agents");
  const says = num("policy.max_says_per_day");
  if (says !== null) can.push(`Write to you at most ${says} time${says === 1 ? "" : "s"} a day (it always answers your chat)`);

  return {
    state: stopped ? "Stopped: it does nothing until you press Run on its page" : "Running",
    can,
    cannot: [...cannot, ...NEVER],
  };
}
