// Server-side only: reads the planned pause (lib/trial.ts): the Validator's shared-state/validator-paused.json and
// every bot's workspace/STOP text.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR, listBots } from "./bots";
import { workspaceDir } from "./control";
import { trialOf, type Trial } from "./trial";

export async function readTrial(bots = BOTS_DIR, now = Date.now()): Promise<Trial | null> {
  const file = path.join(bots, "common-data", "shared-state", "validator-paused.json");
  const mtime = (p: string) => stat(/*turbopackIgnore: true*/ p).then((s) => s.mtimeMs, () => null);
  const paused = await readFile(/*turbopackIgnore: true*/ file, "utf8")
    .then((t) => {
      try {
        return JSON.parse(t) as unknown;
      } catch {
        return {}; // the file is there: the pause is on, even if its text cannot be read
      }
    })
    .catch(() => null);
  const stops = await listBots()
    .then((all) =>
      Promise.all(
        all.map(async (b) => {
          const p = path.join(await workspaceDir(b), "STOP");
          return { text: await readFile(/*turbopackIgnore: true*/ p, "utf8").catch(() => ""), at: await mtime(p) };
        }),
      ),
    )
    .catch(() => [] as { text: string; at: number | null }[]);
  return trialOf(paused, stops.map((s) => s.text), { now, pausedAt: paused ? await mtime(file) : null, stopAt: stops.map((s) => s.at) });
}
