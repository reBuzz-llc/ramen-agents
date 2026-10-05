// Server-side only: an AI-written recap of what one bot did in a period, and how that work tracks its
// goal, for the Summary tab. The facts come from the bot's own database (lib/summary.ts) with short ids
// ([e12] episode, [n40] note, [q7] question, [t3] task) so the recap can cite them and the page can link
// each citation back to the trail. The text is written by the bot's own model through
// scripts/digest.py, which keeps a Tor or plain-only bot (the Onion Reader) on its local model.
// Recaps are cached in data/digests/<slug>-<range>.json and only rewritten when the owner asks.
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BotProfile } from "./bot";
import { CODE_ROOT, readConfig } from "./bots";
import { dbPath, query } from "./episodes";
import { readPersona } from "./persona";
import { RANGES, sq, summary, type RangeKey } from "./summary";

const DIR = process.env.DIGESTS_DIR || path.join(process.cwd(), "data", "digests");
const FRESH_MS = 2 * 60e3; // a second request this soon returns the recap just written
const inFlight = new Map<string, Promise<Digest>>();

export const VERDICTS = ["on track", "some progress", "off track", "no activity"] as const;
export type Verdict = (typeof VERDICTS)[number];
export type Digest = {
  bot: string;
  range: RangeKey;
  generatedAt: string;
  model: string;
  localOnly: boolean;
  goalSource: "goals" | "expected output" | "bio";
  goalText: string;
  recap: string;
  highlights: { text: string; refs: string[] }[];
  goals: { goal: string; verdict: Verdict; evidence: string; refs: string[] }[];
  next: string;
};

const file = (bot: BotProfile, range: RangeKey) => path.join(DIR, `${bot.slug}-${range}.json`);

export async function readDigest(bot: BotProfile, range: RangeKey): Promise<Digest | null> {
  try {
    return JSON.parse(await readFile(/*turbopackIgnore: true*/ file(bot, range), "utf8")) as Digest;
  } catch {
    return null;
  }
}

async function goalOf(bot: BotProfile): Promise<{ source: Digest["goalSource"]; text: string }> {
  const doc = await readPersona(bot);
  if (doc.goals.trim()) return { source: "goals", text: doc.goals.trim().slice(0, 1400) };
  const expected = doc.persona.split(/^##\s+/m).find((s) => /^expected output/i.test(s));
  if (expected) return { source: "expected output", text: expected.replace(/^.*\n/, "").trim().slice(0, 1400) };
  return { source: "bio", text: doc.bio.slice(0, 400) };
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

async function facts(bot: BotProfile, range: RangeKey, budget: number): Promise<{ text: string; ids: Set<string>; goal: Awaited<ReturnType<typeof goalOf>> }> {
  const [data, goal] = await Promise.all([summary(bot, range), goalOf(bot)]);
  const db = await dbPath(bot);
  const outputs = await query(
    db,
    `SELECT action_type, payload FROM actions WHERE ts >= ${sq(data.since)} AND verdict = 'allowed' AND action_type IN ('package','message','provider') ORDER BY id DESC LIMIT 20`,
  ).catch(() => []);
  const ids = new Set<string>();
  const t = data.totals;
  const p = data.previous;
  const lines: string[] = [
    `AGENT: ${bot.name}. ${clip(bot.bio, 300)}`,
    `GOAL (${goal.source === "goals" ? "the owner's goal for it" : goal.source === "expected output" ? "what its persona says it should produce" : "its bio; no goal is written"}): ${clip(goal.text, 1400)}`,
    `PERIOD: the last ${RANGES[range].label}.`,
    `COUNTS (previous period in brackets): episodes ${t.episodes} (${p.episodes}), notes ${t.notes} (${p.notes}), questions answered ${t.answered} (${p.answered}), tasks ${t.tasks} (${p.tasks}), pages read ${t.pages} (${p.pages}), actions refused by its safety rules ${t.refused} of ${t.actions}.`,
    `TOP SOURCES: ${data.domains.slice(0, 5).map((d) => `${d.domain} ${d.pages}`).join(", ") || "none"}.`,
  ];
  if (outputs.length) {
    lines.push("OUTPUTS SENT:");
    for (const o of outputs) {
      let v: Record<string, unknown> = {};
      try {
        v = JSON.parse(String(o.payload));
      } catch {}
      const type = String(o.action_type);
      lines.push(`- ${type}: ${clip(String(v.name ?? v.text ?? ""), 140)}${v.price ? ` (${String(v.price)})` : ""}${v.to ? ` to ${String(v.to)}` : ""}`);
    }
  }
  const sections: [string, typeof data.trail.nodes][] = [
    ["QUESTIONS", data.trail.nodes.filter((n) => n.kind === "question")],
    ["TASKS", data.trail.nodes.filter((n) => n.kind === "task")],
    ["EPISODES (newest first)", data.trail.nodes.filter((n) => n.kind === "episode")],
    ["NOTES (newest first)", data.trail.nodes.filter((n) => n.kind === "note")],
  ];
  let used = lines.join("\n").length;
  for (const [title, nodes] of sections) {
    if (!nodes.length) continue;
    lines.push(`${title}:`);
    for (const n of nodes) {
      const line =
        n.kind === "question"
          ? `[${n.id}] ${clip(n.label, 200)} (${n.detail.toLowerCase()})`
          : n.kind === "episode"
            ? `[${n.id}] ${clip(n.detail || "no summary yet", 260)}`
            : n.kind === "note"
              ? `[${n.id}] ${clip(n.label, 120)}: ${clip(n.detail, 160)}`
              : `[${n.id}] ${clip(n.label, 160)}`;
      if (used + line.length > budget) break;
      used += line.length + 1;
      lines.push(line);
      ids.add(n.id);
    }
  }
  return { text: lines.join("\n"), ids, goal };
}

const SYSTEM =
  "You write a short, factual recap of an automated agent's recent work for the person who runs it. " +
  "Use only the facts you are given; never invent numbers, names or events. Cite the facts you rely on by their ids, " +
  "like [n12] or [e96]. Plain, specific language; no hype. Reply with one JSON object and nothing else.";

const FORMAT = `Reply with JSON in exactly this shape:
{"recap": "2 to 4 sentences: what it worked on and what came out of it",
 "highlights": [{"text": "one concrete finding or result", "refs": ["n12"]}],
 "goals": [{"goal": "the goal in a few words", "verdict": "on track | some progress | off track | no activity", "evidence": "one sentence on why", "refs": ["e96", "n40"]}],
 "next": "one sentence: the most useful thing it could do next for the goal, or empty"}
At most 4 highlights and 3 goals. Use only ids that appear in the facts.`;

function parseReply(raw: string, ids: Set<string>): Pick<Digest, "recap" | "highlights" | "goals" | "next"> {
  const refs = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).replace(/[[\]\s]/g, "")).filter((x) => ids.has(x)).slice(0, 6) : []);
  const s = raw.replace(/```(?:json)?/g, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  try {
    const v = JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
    const arr = (x: unknown) => (Array.isArray(x) ? (x as Record<string, unknown>[]).filter((i) => i && typeof i === "object") : []);
    return {
      recap: clip(String(v.recap ?? ""), 1200),
      highlights: arr(v.highlights).slice(0, 4).map((h) => ({ text: clip(String(h.text ?? ""), 300), refs: refs(h.refs) })).filter((h) => h.text),
      goals: arr(v.goals).slice(0, 3).map((g) => {
        const verdict = String(g.verdict ?? "").toLowerCase().trim();
        return { goal: clip(String(g.goal ?? ""), 140), verdict: (VERDICTS as readonly string[]).includes(verdict) ? (verdict as Verdict) : "some progress", evidence: clip(String(g.evidence ?? ""), 300), refs: refs(g.refs) };
      }).filter((g) => g.goal),
      next: clip(String(v.next ?? ""), 300),
    };
  } catch {
    return { recap: clip(raw, 1200), highlights: [], goals: [], next: "" };
  }
}

function runDigestScript(bot: BotProfile, payload: string): Promise<{ text?: string; model?: string; localOnly?: boolean; error?: string }> {
  const python = path.join(CODE_ROOT, ".venv", "bin", "python");
  const script = path.join(process.cwd(), "scripts", "digest.py");
  return new Promise((resolve, reject) => {
    const child = execFile(python, [script, bot.configPath], { cwd: CODE_ROOT, timeout: 300000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(`the model did not answer (${err.killed ? "timed out" : err.message.split("\n")[0]})`));
      try {
        resolve(JSON.parse(stdout.trim().split("\n").pop() ?? "{}"));
      } catch {
        reject(new Error("the digest script printed something unexpected"));
      }
    });
    child.stdin?.end(payload);
  });
}

export async function writeDigest(bot: BotProfile, range: RangeKey): Promise<Digest> {
  const key = `${bot.slug}-${range}`;
  const running = inFlight.get(key);
  if (running) return running;
  const job = (async () => {
    const cached = await readDigest(bot, range);
    if (cached && Date.now() - new Date(cached.generatedAt).getTime() < FRESH_MS) return cached;
    // A local model reads slowly and has a small context, so it gets fewer facts.
    const cfg = await readConfig(bot.configPath);
    const local = cfg.get("model.provider") === "ollama" || cfg.get("browser.backend") === "tor";
    const f = await facts(bot, range, local ? 4500 : 9000);
    const out = await runDigestScript(bot, JSON.stringify({ system: SYSTEM, prompt: `${f.text}\n\n${FORMAT}` }));
    if (out.error) throw new Error(out.error);
    if (!out.text?.trim()) throw new Error("the model returned nothing (every provider may be busy or out of quota); try again later");
    const digest: Digest = {
      bot: bot.slug,
      range,
      generatedAt: new Date().toISOString(),
      model: out.model ?? "",
      localOnly: Boolean(out.localOnly),
      goalSource: f.goal.source,
      goalText: f.goal.text,
      ...parseReply(out.text, f.ids),
    };
    await mkdir(DIR, { recursive: true });
    const tmp = `${file(bot, range)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await writeFile(tmp, JSON.stringify(digest, null, 1));
    await rename(tmp, file(bot, range));
    return digest;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}
