// The floating screens' pictures (queue 39): the engine keeps one screenshot per bot, <ws>/screenshots/current.png,
// replaced at every page it draws and deleted for a text-only page. On each web poll, when a bot's current.png was
// written within 60 s after its latest valid page, it is copied into a small ring,
// common-data/shared-state/web-shots/<slug>-<YYYYMMDDTHHMMSS>.png (git-ignored), named after that page's visit; the
// ring keeps the newest 12 files. Pages the bots read as text get their picture from scripts/web-shots.py (queue 41),
// which renders them and names the file <slug>-<YYYYMMDDTHHMMSS>-<8 hex of sha1(url)>.png. A page shows a picture
// when the ring holds one for its address (by that hash) or for its very visit (by the name).
// Node imports only, so the test runs with Node's own runner.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

export const RING_KEEP = 12;
const AFTER_MS = 60_000;

/** The ring's file name for a bot's page visit at local time `ts` ("2026-10-31T11:05:09"). */
export const shotName = (slug: string, ts: string) => `${slug}-${ts.replace(/[-:]/g, "")}.png`;
/** A file name the shot route may serve: a ring name and nothing else (no path, no other file). */
export const isShotName = (name: string) => /^[a-z0-9-]+-\d{8}T\d{6}(-[0-9a-f]{8})?\.png$/.test(name);
/** The 8 hex of sha1(url) a rendered picture carries in its name (as scripts/web-shots.py writes it). */
export const urlHash = (url: string) => createHash("sha1").update(url, "utf8").digest("hex").slice(0, 8);

/** The ring file for a page: one rendered for its address first, else the copy taken at its visit; null when none. */
export function shotFor(files: Set<string>, page: { slug: string; ts: string; url: string }): string | null {
  const tail = `-${urlHash(page.url)}.png`;
  for (const f of files) if (f.endsWith(tail)) return f;
  const byVisit = shotName(page.slug, page.ts);
  return files.has(byVisit) ? byVisit : null;
}

const localMs = (ts: string) => new Date(ts).getTime();

/** Copy each bot's current picture into the ring when it belongs to its latest valid page, then keep the newest 12. */
export async function syncRing(dir: string, bots: { slug: string; ws: string; lastValid: string | null }[]): Promise<void> {
  await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
  for (const b of bots) {
    if (!b.lastValid) continue;
    const src = path.join(b.ws, "screenshots", "current.png");
    const s = await stat(/*turbopackIgnore: true*/ src).catch(() => null);
    if (!s) continue;
    const opened = localMs(b.lastValid);
    if (!(s.mtimeMs >= opened && s.mtimeMs <= opened + AFTER_MS)) continue; // a picture of another page
    const dest = path.join(dir, shotName(b.slug, b.lastValid));
    if (await stat(/*turbopackIgnore: true*/ dest).catch(() => null)) continue;
    await copyFile(/*turbopackIgnore: true*/ src, dest).catch(() => undefined);
  }
  const files = (await readdir(/*turbopackIgnore: true*/ dir).catch(() => [] as string[])).filter(isShotName);
  const dated = await Promise.all(files.map(async (f) => ({ f, at: (await stat(/*turbopackIgnore: true*/ path.join(dir, f)).catch(() => null))?.mtimeMs ?? 0 })));
  dated.sort((a, b) => b.at - a.at);
  await Promise.all(dated.slice(RING_KEEP).map((d) => unlink(/*turbopackIgnore: true*/ path.join(dir, d.f)).catch(() => undefined)));
}

/** The ring's names now, for matching pages to their pictures. */
export async function ringFiles(dir: string): Promise<Set<string>> {
  return new Set((await readdir(/*turbopackIgnore: true*/ dir).catch(() => [] as string[])).filter(isShotName));
}
