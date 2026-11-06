// The team portal's settings, Node imports only (the tests load it with Node's own runner): common.toml's
// `[leads] portal_url` decides where the Leads board lives (unset: Notion), and in local mode the tunnel's address.
// lib/portal.ts reads the leads; docs/setup-queue.md step 9, docs/portal-database.md.
import { readFile } from "node:fs/promises";
import path from "node:path";

const BOTS_DIR = process.env.BOTS_DIR ?? path.join(process.env.HOME ?? "", "bots");
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;

/** The portal's address (common.toml [leads] portal_url), or "" when the board is on Notion. Read with a small scan of
 *  the [leads] table: the one key, a plain quoted string. */
export async function portalUrl(bots = BOTS_DIR): Promise<string> {
  try {
    const text = await readFile(/*turbopackIgnore: true*/ path.join(bots, "common-data", "configs", "common.toml"), "utf8");
    let table = "";
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      const head = /^\[([^\[\]]+)\]/.exec(line);
      if (head) table = head[1].trim();
      else if (table === "leads") {
        const m = /^portal_url\s*=\s*"([^"]*)"/.exec(line);
        if (m) return m[1].trim().replace(/\/$/, "");
      }
    }
    return "";
  } catch {
    return "";
  }
}

/** Where the Leads board lives: the portal when common.toml names one, else Notion. */
export async function leadsSource(bots = BOTS_DIR): Promise<{ store: "notion" | "portal"; url: string }> {
  const url = await portalUrl(bots);
  return url ? { store: "portal", url } : { store: "notion", url: "" };
}

export type PortalLocal = { url: string; since: string } | null;

/** The team's address while the portal runs on this Mac (local mode: portal_url points here and scripts/portal-tunnel.sh
 *  writes shared-state/portal-local.json); null otherwise, "" before the tunnel has come up. */
export async function portalLocal(bots = BOTS_DIR): Promise<PortalLocal> {
  if (!LOCAL.test(await portalUrl(bots))) return null;
  try {
    const d = JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(bots, "common-data", "shared-state", "portal-local.json"), "utf8")) as { url?: unknown; since?: unknown };
    return typeof d.url === "string" && /^https:\/\//.test(d.url) ? { url: d.url, since: String(d.since ?? "") } : { url: "", since: "" };
  } catch {
    return { url: "", since: "" };
  }
}
