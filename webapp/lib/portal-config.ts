// Where the boards live, Node imports only (the tests load it with Node's own runner): common.toml's `[leads] portal_url`.
// It points at this dashboard by default ("http://127.0.0.1:3000"): the local board in common-data/local-board.sqlite3
// (lib/local-board.ts, queue 572), read here straight from the file. Any other address is the hosted portal, read over
// its API with the dashboard's key (lib/portal.ts); while that portal runs on this Mac (its own local mode, port 3100),
// the tunnel's address. docs/boards.md.
import { readFile } from "node:fs/promises";
import path from "node:path";

const BOTS_DIR = process.env.BOTS_DIR ?? path.join(process.env.HOME ?? "", "bots");
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;
/** This dashboard's own address: portal_url set to it (or unset) is the local board. */
const SELF = /^https?:\/\/(127\.0\.0\.1|localhost)(:3000)?\/?$/;

/** The board's address (common.toml [leads] portal_url, a local overlay's value winning), or "" when unset. Read with a
 *  small scan of the [leads] table: the one key, a plain quoted string. */
export async function portalUrl(bots = BOTS_DIR): Promise<string> {
  // the shared overlay (common-data/configs/local.toml, git-ignored) wins over the tracked common.toml
  for (const file of ["local.toml", "common.toml"]) {
    const v = await scanUrl(path.join(bots, "common-data", "configs", file));
    if (v !== null) return v;
  }
  return "";
}
async function scanUrl(file: string): Promise<string | null> {
  try {
    const text = await readFile(/*turbopackIgnore: true*/ file, "utf8");
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
    return null;
  } catch {
    return null;
  }
}

/** Where the boards live: this dashboard's own local board (portal_url unset, or this dashboard's address), else the
 *  hosted portal at portal_url. */
export async function leadsSource(bots = BOTS_DIR): Promise<{ store: "local" | "portal"; url: string }> {
  const url = await portalUrl(bots);
  return !url || SELF.test(url) ? { store: "local", url: "" } : { store: "portal", url };
}

export type PortalLocal = { url: string; since: string } | null;

/** The team's address while the portal runs on this Mac (local mode: portal_url points here and scripts/portal-tunnel.sh
 *  writes shared-state/portal-local.json); null otherwise, "" before the tunnel has come up. */
export async function portalLocal(bots = BOTS_DIR): Promise<PortalLocal> {
  const url = await portalUrl(bots);
  if (!LOCAL.test(url) || SELF.test(url)) return null; // this dashboard's own board is not the portal's local mode
  try {
    const d = JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(bots, "common-data", "shared-state", "portal-local.json"), "utf8")) as { url?: unknown; since?: unknown };
    return typeof d.url === "string" && /^https:\/\//.test(d.url) ? { url: d.url, since: String(d.since ?? "") } : { url: "", since: "" };
  } catch {
    return { url: "", since: "" };
  }
}
