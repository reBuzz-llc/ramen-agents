// Server-side only: the Validator's last tick, from common-data/shared-state/tick-report.json (its "at", local time
// without a zone), judged against now by lib/tick.ts.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pausedTick, tickOf, type Tick } from "./tick";
import { readTrial } from "./trial-read";

export async function readTick(bots: string, now = Date.now()): Promise<Tick> {
  const trial = await readTrial(bots).catch(() => null);
  try {
    const d = JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(bots, "common-data", "shared-state", "tick-report.json"), "utf8")) as { at?: unknown };
    return pausedTick(tickOf(d.at, now), trial?.line);
  } catch {
    return pausedTick(tickOf(null, now), trial?.line);
  }
}
