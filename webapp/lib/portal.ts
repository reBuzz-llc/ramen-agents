// Server-side only: the team portal (the `portal` branch) as the Leads board's home. One setting for the whole family,
// common.toml's `[leads] portal_url`: set, the agents, the Validator and this dashboard read and write leads there;
// unset (the default), the Leads board stays on Notion. The dashboard reads with its own read-only key,
// common-data/keys/portal-dashboard.key, read at each request and never from the environment; it is minted in the
// portal's checkout with `node --env-file=.env.local scripts/api-key.mjs dashboard board:read`. The board is kept in
// common-data/shared-state/portal-leads-cache-dashboard.json so each read pulls only what changed (lib/lead-rows.ts).
// That file is the dashboard's own: portal-leads-cache.json is the engine's and the Validator's shared copy (another
// shape, its own lock), which the dashboard never reads or writes; one file for both made each side throw the other's
// copy away and pull the whole board again.
// docs/setup-queue.md step 9, docs/portal-database.md.
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR } from "./bots";
import { readPortalCached, type PortalCache } from "./lead-rows";
export { leadsSource, portalLocal, portalUrl, type PortalLocal } from "./portal-config";

export const DASHBOARD_CACHE_FILE = "portal-leads-cache-dashboard.json";
/** The engine's and the Validator's shared copy: the dashboard never reads or writes it. */
export const SHARED_CACHE_FILE = "portal-leads-cache.json";
export const portalCache = (bots = BOTS_DIR) => path.join(bots, "common-data", "shared-state", DASHBOARD_CACHE_FILE);
export const portalKey = (bots = BOTS_DIR) => path.join(bots, "common-data", "keys", "portal-dashboard.key");
const MINT = "mint it in the portal's checkout: node --env-file=.env.local scripts/api-key.mjs dashboard board:read, into common-data/keys/portal-dashboard.key";

/** Every live lead from the portal with the dashboard's key, through the cache (only what changed travels); a missing
 *  key is said plainly. */
export async function portalLeads(url: string, bots = BOTS_DIR): Promise<Record<string, unknown>[]> {
  let key = "";
  try {
    key = (await readFile(/*turbopackIgnore: true*/ portalKey(bots), "utf8")).trim();
  } catch {
    throw new Error(`No portal key for the dashboard: ${MINT}.`);
  }
  if (!key) throw new Error(`The portal key file is empty: ${MINT}.`);
  const file = portalCache(bots);
  const cache = (await readFile(/*turbopackIgnore: true*/ file, "utf8").then((s) => JSON.parse(s) as PortalCache).catch(() => null)) ?? null;
  const r = await readPortalCached(url, key, cache);
  const tmp = `${file}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(r.cache), "utf8")
    .then(() => rename(/*turbopackIgnore: true*/ tmp, file))
    .catch(() => {}); // a cache that cannot be saved means a full pull next time, never a failed page
  return r.leads;
}
