// Run: npm test. When the team's board is Peek on this Mac (sh scripts/peek.sh setup sets [leads] portal_url to
// http://127.0.0.1:3100), the dashboard's board pages open Peek's own page for that board; with the local board, or a
// hosted portal, they stay as they were.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error TS5097 -- the extension lets Node's own test runner load it
import { leadsSource, portalUrl } from "../lib/portal-config.ts";

const page = readFileSync(new URL("../app/boards/[board]/page.tsx", import.meta.url), "utf8");

test("each board's page on Peek", () => {
  assert.match(page, /const PEEK_PAGE: Record<string, string> = \{ leads: "\/leads", tasks: "\/queue", packages: "\/packages" \};/);
  assert.match(page, /if \(!local && PEEK_HERE\.test\(src\.url\)\) redirect\(`\$\{src\.url\}\$\{PEEK_PAGE\[board\]\}`\);/);
  const here = /^https?:\/\/(127\.0\.0\.1|localhost):3100$/;
  assert.ok(here.test("http://127.0.0.1:3100"));
  assert.ok(!here.test("https://portal.example.com"), "a hosted portal keeps the note");
  assert.ok(!here.test("http://127.0.0.1:3000"), "the dashboard itself is the local board");
});

test("the address setup writes is read as Peek, and back is the local board again", async () => {
  const bots = await mkdtemp(path.join(tmpdir(), "peek-board-"));
  await mkdir(path.join(bots, "common-data", "configs"), { recursive: true });
  const local = path.join(bots, "common-data", "configs", "local.toml");
  await writeFile(local, '[agent]\nname = "x"\n\n[leads]\nportal_url = "http://127.0.0.1:3100"\n');
  assert.equal(await portalUrl(bots), "http://127.0.0.1:3100");
  assert.deepEqual(await leadsSource(bots), { store: "portal", url: "http://127.0.0.1:3100" });
  await writeFile(local, '[agent]\nname = "x"\n\n[leads]\n');
  assert.equal((await leadsSource(bots)).store, "local");
});
