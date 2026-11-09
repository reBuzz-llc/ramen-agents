// Server-side only: the shared change log, common-data/knowledge/changes.jsonl: one line per
// change that can move a metric, appended by every session, so a jump on the dashboard's charts has a visible cause.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { BOTS_DIR } from "./bots";
import { engineMarkers, restartMarkers, type Marker } from "./checks";

export type Change = { at: string; by: string; bots: string[]; area: string; what: string; why: string };

const FILE = path.join(BOTS_DIR, "common-data", "knowledge", "changes.jsonl");

export async function readChanges(days = 14): Promise<Change[]> {
  let text = "";
  try {
    text = await readFile(/*turbopackIgnore: true*/ FILE, "utf8");
  } catch {
    return [];
  }
  const d = new Date(Date.now() - days * 86400e3);
  const since = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const out: Change[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Partial<Change>;
      const at = String(r.at ?? "");
      if (at.slice(0, 10) < since) continue;
      out.push({
        at,
        by: String(r.by ?? ""),
        bots: Array.isArray(r.bots) ? r.bots.map(String) : ["*"],
        area: String(r.area ?? ""),
        what: String(r.what ?? "").slice(0, 240),
        why: String(r.why ?? "").slice(0, 240),
      });
    } catch {
      /* a torn line */
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

const ENGINE = process.env.BOT_CODE_ROOT ?? path.join(homedir(), "Projects", "bot");
const TICK = path.join(BOTS_DIR, "common-data", "shared-state", "tick-report.json");

/** The change markers under the Checks bars: the engine's commits, each bot's last restart (the
 *  tick report), and the shared change log's notes, newest first. */
export async function readMarkers(days = 14): Promise<Marker[]> {
  const [notes, engine, tick] = await Promise.all([
    readChanges(days),
    promisify(execFile)("git", ["-C", ENGINE, "log", `--since=${days}.days`, "--pretty=%cI|%h|%s"], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 })
      .then((r) => engineMarkers(r.stdout))
      .catch(() => [] as Marker[]),
    readFile(/*turbopackIgnore: true*/ TICK, "utf8")
      .then((t) => restartMarkers(JSON.parse(t)))
      .catch(() => [] as Marker[]),
  ]);
  const fromNotes: Marker[] = notes.map((c) => ({ at: c.at, by: c.by, bots: c.bots, kind: "note", what: c.what }));
  return [...fromNotes, ...engine, ...tick].sort((a, b) => (a.at < b.at ? 1 : -1));
}
