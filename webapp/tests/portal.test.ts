// The Leads board's home: Notion until common.toml's [leads] portal_url names the team portal;
// and local mode's tunnel address.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
// @ts-ignore TS5097
import { leadsSource, portalLocal, portalUrl } from "../lib/portal-config.ts";

function fleet(common: string, shared: Record<string, unknown> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "portal-"));
  for (const d of ["configs", "keys", "shared-state"]) mkdirSync(path.join(dir, "common-data", d), { recursive: true });
  writeFileSync(path.join(dir, "common-data", "configs", "common.toml"), common);
  for (const [f, v] of Object.entries(shared)) writeFileSync(path.join(dir, "common-data", "shared-state", f), JSON.stringify(v));
  return dir;
}

test("no portal_url: the board stays on Notion", async () => {
  const dir = fleet('[agent]\nmode = "web"\n[leads]\n# portal_url = "https://x"\n');
  assert.equal(await portalUrl(dir), "");
  assert.deepEqual(await leadsSource(dir), { store: "notion", url: "" });
  assert.equal(await portalLocal(dir), null);
});

test("portal_url under [leads] (only there) moves the board to the portal", async () => {
  const dir = fleet('[other]\nportal_url = "https://wrong.example"\n[leads]\nportal_url = "https://portal.example/"\n');
  assert.deepEqual(await leadsSource(dir), { store: "portal", url: "https://portal.example" });
});

test("local mode: the tunnel's address once it is up", async () => {
  const before = fleet('[leads]\nportal_url = "http://127.0.0.1:3100"\n');
  assert.deepEqual(await portalLocal(before), { url: "", since: "" });
  const up = fleet('[leads]\nportal_url = "http://127.0.0.1:3100"\n', { "portal-local.json": { url: "https://a-b-c.trycloudflare.com", since: "2026-11-06T21:00:00" } });
  assert.deepEqual(await portalLocal(up), { url: "https://a-b-c.trycloudflare.com", since: "2026-11-06T21:00:00" });
});
