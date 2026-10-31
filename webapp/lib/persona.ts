// Server-side only: read and write a bot's persona, goals and bio.
//
// The bot reads `[agent] persona_file` (persona.md) and `[agent] bio` from its config once, when the agent
// starts, and puts both in its system prompt (src/explorer/controller.py, prompts.py). There is no separate
// goals file: goals are a `## ...goal...` section of persona.md (the CEO's "The goal right now"), so the page
// edits that section on its own and the rest of the persona beside it, and saves them back into one file.
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { BotProfile } from "./bot";
import { readConfig } from "./bots";
const GOAL_HEADING = /^##\s+.*\bgoals?\b/i;
const DEFAULT_GOAL_HEADING = "## Goals";

type PersonaDoc = {
  name: string;
  bio: string;
  persona: string;
  goals: string;
  /** The goal section's heading as written in persona.md, or the one a save will add. */
  goalHeading: string;
  goalHeadingExists: boolean;
  personaPath: string;
  /** Headings of the persona, in order, for the outline. */
  outline: string[];
  version: string;
  updatedAt: string | null;
};

type Section = { heading: string | null; raw: string };

/** Split markdown at level-2 headings, ignoring anything inside ``` fences. */
function sections(text: string): Section[] {
  const out: Section[] = [{ heading: null, raw: "" }];
  let fence = false;
  for (const line of text.replace(/\r\n/g, "\n").split(/(?<=\n)/)) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (!fence && /^##\s+\S/.test(line)) out.push({ heading: line.trim(), raw: line });
    else out[out.length - 1].raw += line;
  }
  return out;
}

function splitGoals(text: string): { persona: string; goals: string; heading: string | null; index: number } {
  const all = sections(text);
  const i = all.findIndex((s) => s.heading !== null && GOAL_HEADING.test(s.heading));
  if (i < 0) return { persona: text, goals: "", heading: null, index: all.length };
  const goal = all[i];
  const body = goal.raw.slice(goal.raw.indexOf("\n") + 1);
  const rest = all.filter((_, j) => j !== i).map((s) => s.raw);
  if (i > 0 && i < all.length - 1) rest[i - 1] = rest[i - 1].replace(/\n*$/, "\n\n");
  return { persona: rest.join("").replace(/\n{3,}$/, "\n"), goals: body.trim(), heading: goal.heading, index: i };
}

async function configInfo(bot: BotProfile): Promise<{ toml: string; bio: string; personaPath: string; personaSet: boolean }> {
  const toml = await readFile(/*turbopackIgnore: true*/ bot.configPath, "utf8");
  const values = await readConfig(bot.configPath); // bio and persona_file may come from a shared file
  const bio = values.get("agent.bio");
  const file = values.get("agent.persona_file");
  const personaSet = typeof file === "string" && file.trim() !== "";
  return {
    toml,
    bio: typeof bio === "string" ? bio : "",
    personaPath: path.resolve(path.dirname(bot.configPath), personaSet ? (file as string) : "persona.md"),
    personaSet,
  };
}

function version(persona: string, bio: string): string {
  return createHash("sha256").update(persona).update("\0").update(bio).digest("hex").slice(0, 16);
}

async function readText(p: string): Promise<{ text: string; mtime: string | null }> {
  try {
    const text = await readFile(/*turbopackIgnore: true*/ p, "utf8");
    return { text, mtime: (await stat(/*turbopackIgnore: true*/ p)).mtime.toISOString() };
  } catch {
    return { text: "", mtime: null };
  }
}

export async function readPersona(bot: BotProfile): Promise<PersonaDoc> {
  const cfg = await configInfo(bot);
  const { text, mtime } = await readText(cfg.personaPath);
  const split = splitGoals(text);
  return {
    name: bot.name,
    bio: cfg.bio,
    persona: split.persona,
    goals: split.goals,
    goalHeading: split.heading ?? DEFAULT_GOAL_HEADING,
    goalHeadingExists: split.heading !== null,
    personaPath: cfg.personaPath,
    outline: sections(text)
      .map((s) => s.heading)
      .filter((h): h is string => h !== null)
      .map((h) => h.replace(/^##\s+/, "")),
    version: version(text, cfg.bio),
    updatedAt: mtime,
  };
}
