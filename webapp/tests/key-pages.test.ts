import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error TS5097
import { keyPage, NEEDS_FIX } from "../lib/key-pages.ts";

test("a key page per provider, with its host; the team's own keys and unknown names get none (owner 11-12)", () => {
  assert.deepEqual(keyPage("groq"), { url: "https://console.groq.com/keys", host: "console.groq.com" });
  assert.equal(keyPage("orcarouter")?.host, "orcarouter.ai");
  assert.equal(keyPage("cloudflare-r2")?.host, "dash.cloudflare.com");
  assert.equal(keyPage("portal-owner"), null);
  assert.equal(keyPage("world-share"), null);
  assert.equal(keyPage("no-such-provider"), null);
  assert.deepEqual([...NEEDS_FIX], ["not working", "limited", "paused", "no key"]);
});
