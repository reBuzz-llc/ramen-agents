// The dashboard keeps its leads cache in its own file: portal-leads-cache.json is the engine's and the Validator's
// shared copy (another shape, its own lock), and one file for both made each side throw the other's away and pull the
// whole board again. lib/portal.ts imports app modules, so it is read as text here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const src = readFileSync(new URL("../lib/portal.ts", import.meta.url), "utf8");

test("the dashboard's cache file is its own, never the shared one", () => {
  const own = /DASHBOARD_CACHE_FILE = "([^"]+)"/.exec(src)?.[1];
  const shared = /SHARED_CACHE_FILE = "([^"]+)"/.exec(src)?.[1];
  assert.equal(own, "portal-leads-cache-dashboard.json");
  assert.equal(shared, "portal-leads-cache.json");
  assert.notEqual(own, shared);
  assert.match(src, /portalCache = \(bots = BOTS_DIR\) => path\.join\(bots, "common-data", "shared-state", DASHBOARD_CACHE_FILE\)/);
  assert.equal(src.split('"portal-leads-cache.json"').length - 1, 1); // named once, in its constant
});
