// The Providers page's files: the list (common-data/providers.json, tracked), the keys (common-data/keys/<name>.key, never
// sent to the page), the person's own marks (common-data/local/provider-marks.json, git-ignored) and each member's
// config, to say who uses which key. A deleted key is moved to common-data/keys/deleted/, never erased.
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR, listBots, readConfig } from "./bots";
import { KEYS_DIR, cleanKey } from "./keys";
import { needsTermsScript, TERMS_FIRST } from "./key-terms";
import {
  cleanReason, groupOf, NOT_TESTED, parseList, testOutcome, testRequest, usedBy,
  type Group, type MemberKeys, type OwnMark, type ProviderEntry, type TestOutcome,
} from "./providers-list";

const LIST = path.join(BOTS_DIR, "common-data", "providers.json");
const MARKS = path.join(BOTS_DIR, "common-data", "local", "provider-marks.json");
const DELETED = path.join(KEYS_DIR, "deleted");

export type ProviderRow = ProviderEntry & {
  group: Group;
  hasKey: boolean;
  keyOpen: boolean; // the key file can be read by others: chmod 600 it
  usedBy: string[];
  own: OwnMark | null;
};

export async function readList(): Promise<{ entries: ProviderEntry[]; skipped: string[] }> {
  try {
    return parseList(JSON.parse(await readFile(/*turbopackIgnore: true*/ LIST, "utf8")));
  } catch (err) {
    return { entries: [], skipped: [`providers.json could not be read: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`] };
  }
}

export async function findEntry(name: string): Promise<ProviderEntry | null> {
  return (await readList()).entries.find((e) => e.name === name) ?? null;
}

/** The key file of a listed provider, always inside the keys folder (the list's key_file is "<name>.key"). */
const keyPath = (p: ProviderEntry) => path.join(KEYS_DIR, `${p.name}.key`);

async function keyState(p: ProviderEntry): Promise<{ hasKey: boolean; keyOpen: boolean }> {
  try {
    const s = await stat(/*turbopackIgnore: true*/ keyPath(p));
    return { hasKey: s.isFile() && s.size > 0, keyOpen: (s.mode & 0o077) !== 0 };
  } catch {
    return { hasKey: false, keyOpen: false };
  }
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Each member's chain, search engines and key-file settings, with its git-ignored overlays on top, as the engine reads them. */
export async function memberKeys(): Promise<MemberKeys[]> {
  const out: MemberKeys[] = [];
  const shared = await readConfig(path.join(BOTS_DIR, "common-data", "configs", "local.toml")).catch(() => new Map());
  for (const bot of await listBots()) {
    try {
      const cfg = await readConfig(bot.configPath);
      const own = await readConfig(path.join(path.dirname(bot.configPath), "config.local.toml")).catch(() => new Map());
      for (const [k, v] of [...shared, ...own]) cfg.set(k, v);
      out.push({
        name: bot.name,
        chain: list(cfg.get("model.provider_chain")),
        engines: list(cfg.get("browser.search_engines")),
        strings: [...cfg.values()].filter((v): v is string => typeof v === "string"),
      });
    } catch {
      /* a member whose config cannot be read uses nothing we can name */
    }
  }
  return out;
}

export async function readOwnMarks(): Promise<Record<string, OwnMark>> {
  try {
    const raw = JSON.parse(await readFile(/*turbopackIgnore: true*/ MARKS, "utf8")) as Record<string, OwnMark>;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/** Set or clear the person's own mark (null clears it). Written whole, tmp + rename. */
export async function writeOwnMark(name: string, mark: OwnMark | null): Promise<void> {
  const all = await readOwnMarks();
  if (mark) all[name] = mark;
  else delete all[name];
  await mkdir(/*turbopackIgnore: true*/ path.dirname(MARKS), { recursive: true });
  const tmp = `${MARKS}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmp, `${JSON.stringify(all, null, 1)}\n`, "utf8");
  await rename(/*turbopackIgnore: true*/ tmp, MARKS);
}

export async function providerRows(): Promise<{ rows: ProviderRow[]; skipped: string[] }> {
  const [{ entries, skipped }, members, own] = await Promise.all([readList(), memberKeys(), readOwnMarks()]);
  const rows = await Promise.all(
    entries.map(async (e) => ({ ...e, group: groupOf(e), ...(await keyState(e)), usedBy: usedBy(e, members), own: own[e.name] ?? null })),
  );
  return { rows, skipped };
}

/** Write the key, private (chmod 600), atomically. The key is never returned or logged. */
export async function saveProviderKey(p: ProviderEntry, key: string): Promise<void> {
  if (needsTermsScript(p.name)) throw new Error(TERMS_FIRST);
  await mkdir(/*turbopackIgnore: true*/ KEYS_DIR, { recursive: true, mode: 0o700 });
  const file = keyPath(p);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmp, key, { encoding: "utf8", mode: 0o600 });
  await chmod(/*turbopackIgnore: true*/ tmp, 0o600);
  await rename(/*turbopackIgnore: true*/ tmp, file);
}

export async function readProviderKey(p: ProviderEntry): Promise<string | null> {
  try {
    return cleanKey(await readFile(/*turbopackIgnore: true*/ keyPath(p), "utf8"));
  } catch {
    return null;
  }
}

/** Move the key to keys/deleted/<name>.key.<time>, where it can be put back by hand. Returns the restore file's name. */
export async function deleteProviderKey(p: ProviderEntry): Promise<string> {
  await mkdir(/*turbopackIgnore: true*/ DELETED, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const to = path.join(DELETED, `${p.name}.key.${stamp}`);
  await rename(/*turbopackIgnore: true*/ keyPath(p), to);
  return path.basename(to);
}

/** Test a key with the provider's free read only (a models list or the account): never a completion, so a test cannot
 *  bill. A provider with no free read: saved, not tested. */
export async function testProviderKey(p: ProviderEntry, key: string): Promise<TestOutcome> {
  const req = testRequest(p.test, key);
  if (!req) return NOT_TESTED;
  try {
    const res = await fetch(req.url, { headers: req.headers, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(15000) });
    const text = (await res.text()).slice(0, 600);
    return testOutcome(p.who, res.status, res.status < 300 ? "" : cleanReason(text, key));
  } catch (err) {
    return { ok: false, level: "untested", message: `Saved, not tested: could not reach ${p.who} (${err instanceof Error ? err.name : "network error"})` };
  }
}
