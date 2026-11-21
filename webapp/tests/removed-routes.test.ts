// Run: npm test. The pages removed on 2026-10-30 redirect home; the pages that stay do not.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore TS5097
import { isRemoved, REMOVED_ROUTES } from "../lib/removed-routes.ts";

test("removed pages redirect to /, the remaining ones stay", () => {
  for (const p of ["/bots/lead-gen", "/bots/lead-gen/chat", "/bots/the-ceo/persona", "/chatroom", "/requests", "/send-today", "/family-review", "/family-review/"]) assert.equal(isRemoved(p), true, p);
  for (const p of ["/", "/work-plan", "/settings", "/settings/notifications", "/settings/reports", "/api/board", "/api/bots"]) assert.equal(isRemoved(p), false, p);
  assert.deepEqual([...REMOVED_ROUTES], ["/bots/:path*", "/chatroom", "/requests", "/send-today", "/family-review"]);
});
