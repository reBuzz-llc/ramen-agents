// Server-side only: save and test provider API keys for Settings > Key providers.
//
// Safety rules: a key is written only inside the shared keys folder (chmod 600, atomic), only for a provider
// the bot code knows, and is never sent back to the browser, logged, or put in an error message. Testing
// makes the smallest possible request: list models (is the key valid?), then a one-token completion (does
// it have quota or credit?). Paid-per-second providers are only checked for a valid key.
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { BotProfile } from "./bot";
import { CODE_ROOT } from "./bots";

const run = promisify(execFile);

// turbopackIgnore: the keys folder is read at request time only; it must never be traced into or bundled with the build.
export const KEYS_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.EXPLORER_KEYS_DIR ?? path.join(homedir(), "bots", "common-data", "keys"));

export type ProviderInfo = {
  name: string;
  position?: number;
  auto: boolean;
  note: string;
  model: string;
  baseUrl: string;
  kind: string;
  keyFile: string;
  hasKey: boolean;
  usage?: Record<string, { calls: number; tokens: number }>;
};
export type ProviderCatalog = { bot: string; provider: string; fallback: string; chain: ProviderInfo[]; known: ProviderInfo[] };

export async function providerCatalog(bot: BotProfile): Promise<ProviderCatalog> {
  const python = path.join(CODE_ROOT, ".venv", "bin", "python");
  const script = path.join(process.cwd(), "scripts", "providers-json.py");
  const { stdout } = await run(python, [script, bot.configPath], { cwd: CODE_ROOT, timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout) as ProviderCatalog;
}

export function findProvider(cat: ProviderCatalog, name: string): ProviderInfo | null {
  return cat.chain.find((p) => p.name === name) ?? cat.known.find((p) => p.name === name) ?? null;
}

/** The provider's key file, only if it lies inside the shared keys folder. */
function safeKeyPath(p: ProviderInfo): string | null {
  const file = path.resolve(p.keyFile.replace(/^~(?=\/)/, homedir()));
  return path.dirname(file) === KEYS_DIR && /^[a-z0-9._-]+\.key$/i.test(path.basename(file)) ? file : null;
}

/** Printable characters only, no spaces: what every provider key looks like. */
export function cleanKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return /^[\x21-\x7e]{16,512}$/.test(key) ? key : null;
}

export async function saveKey(p: ProviderInfo, key: string): Promise<void> {
  const file = safeKeyPath(p);
  if (!file) throw new Error(`${p.name}'s key file is outside ${KEYS_DIR}; set it there in the bot config first`);
  await mkdir(/*turbopackIgnore: true*/ KEYS_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmp, key, { encoding: "utf8", mode: 0o600 });
  await chmod(/*turbopackIgnore: true*/ tmp, 0o600);
  await rename(/*turbopackIgnore: true*/ tmp, file);
}

export async function readSavedKey(p: ProviderInfo): Promise<string | null> {
  const file = safeKeyPath(p);
  if (!file) return null;
  try {
    return cleanKey(await readFile(/*turbopackIgnore: true*/ file, "utf8"));
  } catch {
    return null;
  }
}

export type TestResult = { ok: boolean; level: "works" | "valid" | "no-quota" | "rejected" | "error"; message: string };

async function call(url: string, init: RequestInit): Promise<{ status: number; text: string }> {
  const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(15000) });
  const text = (await res.text()).slice(0, 600);
  return { status: res.status, text };
}

/** Pull a human message out of a provider's error body, with any key-looking string removed. */
function reason(text: string, key: string): string {
  let msg = text;
  try {
    const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string; detail?: string };
    msg = (typeof j.error === "string" ? j.error : j.error?.message) ?? j.message ?? j.detail ?? text;
  } catch {
    /* plain text */
  }
  return msg.split(key).join("…").replace(/[A-Za-z0-9_-]{24,}/g, "…").replace(/\s+/g, " ").trim().slice(0, 180);
}

export async function testKey(p: ProviderInfo, key: string): Promise<TestResult> {
  try {
    if (p.kind === "gemini") {
      const base = p.baseUrl.replace(/\/$/, "");
      const list = await call(`${base}/models?pageSize=1`, { headers: { "x-goog-api-key": key } });
      if (list.status === 400 || list.status === 401 || list.status === 403) return { ok: false, level: "rejected", message: `Key rejected (${list.status}): ${reason(list.text, key)}` };
      if (list.status >= 400) return { ok: false, level: "error", message: `Gemini answered ${list.status}: ${reason(list.text, key)}` };
      const gen = await call(`${base}/models/${p.model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with: ok" }] }], generationConfig: { maxOutputTokens: 1 } }),
      });
      if (gen.status < 300) return { ok: true, level: "works", message: `Key works and ${p.model} answered.` };
      if (gen.status === 429) return { ok: false, level: "no-quota", message: `Key is valid, but there is no quota right now: ${reason(gen.text, key)}` };
      return { ok: false, level: "valid", message: `Key is valid, but ${p.model} answered ${gen.status}: ${reason(gen.text, key)}` };
    }
    if (p.kind === "replicate") {
      const acct = await call("https://api.replicate.com/v1/account", { headers: { authorization: `Bearer ${key}` } });
      if (acct.status < 300) return { ok: true, level: "valid", message: "Key is valid. Not tested for credit: Replicate bills per second." };
      return { ok: false, level: acct.status === 401 || acct.status === 403 ? "rejected" : "error", message: `Replicate answered ${acct.status}: ${reason(acct.text, key)}` };
    }
    const base = p.baseUrl.replace(/\/$/, "");
    const auth = { authorization: `Bearer ${key}` };
    const models = await call(`${base}/models`, { headers: auth });
    if (models.status === 401 || models.status === 403) return { ok: false, level: "rejected", message: `Key rejected (${models.status}): ${reason(models.text, key)}` };
    const chat = await call(`${base}/chat/completions`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ model: p.model, messages: [{ role: "user", content: "Reply with: ok" }], max_tokens: 1 }),
    });
    if (chat.status < 300) return { ok: true, level: "works", message: `Key works and ${p.model} answered.` };
    if (chat.status === 401 || chat.status === 403) return { ok: false, level: "rejected", message: `Key rejected (${chat.status}): ${reason(chat.text, key)}` };
    if (chat.status === 402 || chat.status === 429) return { ok: false, level: "no-quota", message: `Key is valid, but no quota or credit (${chat.status}): ${reason(chat.text, key)}` };
    return { ok: false, level: models.status < 300 ? "valid" : "error", message: `${models.status < 300 ? "Key is valid, but " : ""}${p.model} answered ${chat.status}: ${reason(chat.text, key)}` };
  } catch (err) {
    return { ok: false, level: "error", message: `Could not reach ${p.name}: ${err instanceof Error ? err.name : "network error"}` };
  }
}
