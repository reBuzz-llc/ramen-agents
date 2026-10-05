// Server-side only: read and write a bot's persona, goals and bio.
//
// The bot reads `[agent] persona_file` (persona.md) and `[agent] bio` from its config once, when the agent
// starts, and puts both in its system prompt (src/explorer/controller.py, prompts.py). There is no separate
// goals file: goals are a `## ...goal...` section of persona.md (the CEO's "The goal right now"), so the page
// edits that section on its own and the rest of the persona beside it, and saves them back into one file.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BotProfile } from "./bot";
import { readConfig } from "./bots";
import { workspaceDir } from "./control";

export const MAX_PERSONA_BYTES = 64 * 1024;
export const MAX_BIO_CHARS = 400;
const GOAL_HEADING = /^##\s+.*\bgoals?\b/i;
const DEFAULT_GOAL_HEADING = "## Goals";

export type PersonaDoc = {
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

export type PersonaUpdate = { bio: string; persona: string; goals: string; version: string };

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

function joinGoals(persona: string, goals: string, heading: string, index: number): string {
  const all = sections(persona.replace(/\s*$/, "\n"));
  const text = goals.trim();
  if (text) {
    const at = Math.max(1, Math.min(index, all.length));
    all.splice(at, 0, { heading, raw: `${heading}\n\n${text}\n` });
    // Keep one blank line between sections.
    for (let j = 0; j < all.length - 1; j++) all[j].raw = all[j].raw.replace(/\n*$/, "\n\n");
  }
  const out = all.map((s) => s.raw).join("");
  return out.trim() ? out.replace(/\n*$/, "\n") : "";
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

const tomlString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Set a string key in [agent], replacing the line if it exists, else adding it under the header. */
function setAgentKey(toml: string, key: string, value: string): string {
  const lines = toml.split("\n");
  // "[agent]  # note" is still the header. With none, append the table at the end: prepended above a top-level
  // `extends = ...` it would turn that key into agent.extends and cut the bot off from its shared config.
  const start = lines.findIndex((l) => /^\s*\[agent\]\s*(#.*)?$/.test(l));
  if (start < 0) return `${toml.replace(/\n*$/, "")}\n\n[agent]\n${key} = ${tomlString(value)}\n`;
  let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
  if (end < 0) end = lines.length;
  const keyLine = new RegExp(`^\\s*${key}\\s*=`);
  const at = lines.findIndex((l, i) => i > start && i < end && keyLine.test(l));
  if (at >= 0) {
    if (!/^\s*\w+\s*=\s*"(?:[^"\\]|\\.)*"\s*(?:#.*)?$/.test(lines[at])) {
      throw new Error(`[agent] ${key} in config.toml is not a one-line string; edit it by hand`);
    }
    lines[at] = `${key} = ${tomlString(value)}`;
  } else {
    const nameAt = lines.findIndex((l, i) => i > start && i < end && /^\s*name\s*=/.test(l));
    lines.splice((nameAt >= 0 ? nameAt : start) + 1, 0, `${key} = ${tomlString(value)}`);
  }
  return lines.join("\n");
}

async function writeAtomic(p: string, text: string): Promise<void> {
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(/*turbopackIgnore: true*/ tmp, text, "utf8");
  await rename(/*turbopackIgnore: true*/ tmp, p);
}

export class PersonaConflict extends Error {}
export class PersonaInvalid extends Error {}

export async function savePersona(bot: BotProfile, update: PersonaUpdate): Promise<{ doc: PersonaDoc; backup: string | null; changed: boolean }> {
  const bio = update.bio.replace(/\s+/g, " ").trim();
  if (bio.length > MAX_BIO_CHARS) throw new PersonaInvalid(`The bio is limited to ${MAX_BIO_CHARS} characters.`);
  if (sections(update.persona).some((s) => s.heading !== null && GOAL_HEADING.test(s.heading))) {
    throw new PersonaInvalid("The persona has its own goals heading. Put goals in the Goals box instead, so they are not saved twice.");
  }

  const cfg = await configInfo(bot);
  const current = await readText(cfg.personaPath);
  if (version(current.text, cfg.bio) !== update.version) {
    throw new PersonaConflict("The persona or bio changed on disk since you opened this page. Reload to see the new version.");
  }
  const split = splitGoals(current.text);
  const next = joinGoals(update.persona, update.goals, split.heading ?? DEFAULT_GOAL_HEADING, split.index);
  if (Buffer.byteLength(next, "utf8") > MAX_PERSONA_BYTES) {
    throw new PersonaInvalid(`The persona is limited to ${MAX_PERSONA_BYTES / 1024} KB.`);
  }

  const personaChanged = next !== current.text;
  const bioChanged = bio !== cfg.bio;
  let backup: string | null = null;
  if (personaChanged || bioChanged) {
    const dir = path.join(await workspaceDir(bot), "backups");
    await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (personaChanged && current.mtime) {
      backup = path.join(dir, `persona-${stamp}.md`);
      await copyFile(/*turbopackIgnore: true*/ cfg.personaPath, backup);
    }
    if (bioChanged || !cfg.personaSet) {
      await copyFile(/*turbopackIgnore: true*/ bot.configPath, path.join(dir, `config-${stamp}.toml`));
    }
  }
  if (personaChanged) await writeAtomic(cfg.personaPath, next);
  if (bioChanged || (!cfg.personaSet && personaChanged)) {
    let toml = cfg.toml;
    if (bioChanged) toml = setAgentKey(toml, "bio", bio);
    if (!cfg.personaSet && personaChanged) toml = setAgentKey(toml, "persona_file", "persona.md");
    await writeAtomic(bot.configPath, toml);
  }
  return { doc: await readPersona(bot), backup, changed: personaChanged || bioChanged };
}
