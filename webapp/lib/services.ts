// Server-side only: the keys in common-data/keys that are not model providers (owner, 2026-10-02): email checkers,
// web search, storage. Shown on Settings > Key providers with what uses each one and a live status. Every check is a
// FREE call (a sandbox, a usage or a list endpoint), never one that spends the free quota, and is cached for a while
// so opening the page does not hit the services. Key values never leave the server.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { KEYS_DIR } from "./keys";

// verified = false: the key is on file but was not called (a check would spend a credit), so it is not "Ready".
export type ServiceStatus = { name: string; file: string; usedFor: string; signup: string; present: boolean; updated: string | null; ok: boolean | null; verified?: boolean; detail: string };

type Service = {
  name: string;
  file: string;
  usedFor: string;
  signup: string;
  check: (secret: string) => Promise<{ ok: boolean; detail: string; verified?: boolean }>;
};

const TIMEOUT = 12000;
const CACHE_MS = 10 * 60 * 1000;

async function getJson(url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, body };
}

const SERVICES: Service[] = [
  {
    name: "Notion",
    file: "notion.key",
    usedFor: "The CEO, Lead Gen, Package Designer: the task board, Leads board and Packages page",
    signup: "https://www.notion.so/my-integrations",
    check: async (k) => {
      // "Who am I" for the integration: free, reads nothing from the workspace.
      const r = await getJson("https://api.notion.com/v1/users/me", { headers: { Authorization: `Bearer ${k}`, "Notion-Version": "2022-06-28" } });
      const bot = (r.body as { name?: string })?.name;
      return r.status === 200 ? { ok: true, detail: `Integration${bot ? ` "${bot}"` : ""} answers` } : { ok: false, detail: `Refused (HTTP ${r.status})` };
    },
  },
  {
    name: "QuickEmailVerification",
    file: "quickemailverification.key",
    usedFor: "Checks that a lead's email exists before Lead Gen records it (100 free checks a day)",
    signup: "https://quickemailverification.com/",
    check: async (k) => {
      // The sandbox endpoint answers like the real one and costs no credit.
      const r = await getJson(`https://api.quickemailverification.com/v1/verify/sandbox?email=valid@example.com&apikey=${encodeURIComponent(k)}`);
      return r.status === 200 ? { ok: true, detail: "Key accepted (sandbox check, no credit used)" } : { ok: false, detail: `Refused (HTTP ${r.status})` };
    },
  },
  {
    name: "Sniffmail",
    file: "sniffmail.key",
    usedFor: "Backup email checker when QuickEmailVerification is out for the day (500 basic checks a month)",
    signup: "https://sniffmail.io/",
    // Every Sniffmail call spends a credit, so the page only confirms the key is on file and well formed.
    check: async (k) => (/^sniff_[A-Za-z0-9_-]{16,}$/.test(k) ? { ok: true, verified: false, detail: "Not called here: every check spends one of its 500 credits" } : { ok: false, detail: "The key does not look like a Sniffmail key (sniff_…)" }),
  },
  {
    name: "EzVerify",
    file: "ezverify.key",
    usedFor: "Third email checker, when neither QuickEmailVerification nor Sniffmail answers (200 checks a month)",
    signup: "https://ezverify.app/",
    // Every EzVerify check spends one of its monthly credits, so the page only confirms the key is on file.
    check: async (k) => (k.length >= 16 ? { ok: true, verified: false, detail: "Not called here: every check spends one of its 200 monthly credits" } : { ok: false, detail: "The key file looks empty or cut short" }),
  },
  {
    name: "Tavily",
    file: "tavily.key",
    usedFor: "Web search for special sites, used only by The CEO when it asks for it (owner, 2026-10-02); 30 a day at most across the fleet (1,000 free credits a month)",
    signup: "https://www.tavily.com/",
    check: async (k) => {
      const r = await getJson("https://api.tavily.com/usage", { headers: { Authorization: `Bearer ${k}` } });
      if (r.status !== 200) return { ok: false, detail: `Refused (HTTP ${r.status})` };
      const b = r.body as { key?: { usage?: number }; account?: { current_plan?: string; plan_usage?: number; plan_limit?: number } };
      const used = b.account?.plan_usage ?? b.key?.usage ?? 0;
      const limit = b.account?.plan_limit;
      return { ok: true, detail: `Plan ${b.account?.current_plan ?? "?"}: ${used}${limit ? ` of ${limit}` : ""} credits used this month` };
    },
  },
  {
    name: "OrcaRouter",
    file: "orcarouter.key",
    usedFor: "Free AI models (OpenAI-compatible); added to a model chain once its free models answer",
    signup: "https://www.orcarouter.ai/offers",
    check: async (k) => {
      // A valid key can still be refused on the free models ("link an established GitHub account"): a one-token call
      // to the free model is the honest test. It costs nothing, since only free models are tried.
      const auth = { Authorization: `Bearer ${k}`, "Content-Type": "application/json" };
      const models = await getJson("https://api.orcarouter.ai/v1/models", { headers: auth });
      if (models.status !== 200) return { ok: false, detail: `Key refused (HTTP ${models.status})` };
      const chat = await getJson("https://api.orcarouter.ai/v1/chat/completions", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ model: "orcarouter/free", messages: [{ role: "user", content: "ok" }], max_tokens: 1 }),
      });
      if (chat.status === 200) return { ok: true, detail: "Key accepted and the free model answers" };
      const msg = JSON.stringify(chat.body ?? "").match(/"message":"([^"]{0,140})/)?.[1] ?? "";
      return { ok: false, detail: `Key valid, but the free models refuse it (HTTP ${chat.status}${msg ? `: ${msg}` : ""})` };
    },
  },
  {
    name: "Cloudflare R2",
    file: "cloudflare-r2.json",
    usedFor: "File storage; nothing uses it yet",
    signup: "https://dash.cloudflare.com/?to=/:account/r2",
    check: async (raw) => {
      let d: { api_token?: string; account_id?: string };
      try {
        d = JSON.parse(raw) as typeof d;
      } catch {
        return { ok: false, detail: "The file is not valid JSON" };
      }
      if (!d.api_token || !d.account_id) return { ok: false, detail: "api_token or account_id is missing" };
      const r = await getJson(`https://api.cloudflare.com/client/v4/accounts/${d.account_id}/tokens/verify`, { headers: { Authorization: `Bearer ${d.api_token}` } });
      return r.status === 200
        ? { ok: true, detail: "Token active" }
        : { ok: false, detail: `Token refused (HTTP ${r.status}): one character was likely misread from the screenshot (a zero typed as the letter O); re-copy it from the Cloudflare console. R2 itself may also need switching on, and Cloudflare asks for a card for that.` };
    },
  },
];

const g = globalThis as { __services?: { at: number; rows: ServiceStatus[] } };

export async function serviceStatuses(fresh = false): Promise<ServiceStatus[]> {
  if (!fresh && g.__services && Date.now() - g.__services.at < CACHE_MS) return g.__services.rows;
  const rows = await Promise.all(
    SERVICES.map(async (s): Promise<ServiceStatus> => {
      const file = path.join(KEYS_DIR, s.file);
      let secret = "";
      let updated: string | null = null;
      try {
        secret = (await readFile(/*turbopackIgnore: true*/ file, "utf8")).trim();
        updated = (await stat(/*turbopackIgnore: true*/ file)).mtime.toISOString();
      } catch {
        return { name: s.name, file: s.file, usedFor: s.usedFor, signup: s.signup, present: false, updated: null, ok: null, detail: "No key on this Mac" };
      }
      try {
        const r = await s.check(secret);
        return { name: s.name, file: s.file, usedFor: s.usedFor, signup: s.signup, present: true, updated, ...r };
      } catch (err) {
        return { name: s.name, file: s.file, usedFor: s.usedFor, signup: s.signup, present: true, updated, ok: false, detail: `Could not reach it: ${err instanceof Error ? err.message : String(err)}`.slice(0, 160) };
      }
    }),
  );
  g.__services = { at: Date.now(), rows };
  return rows;
}
