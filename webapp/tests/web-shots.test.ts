// Run: npm test. The floating screens' pictures (queue 39): a bot's current screenshot joins the ring only when taken
// within 60 s after its latest valid page; the ring keeps the newest 12; names are the only thing the route serves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-ignore TS5097
import { isShotName, RING_KEEP, shotName, syncRing } from "../lib/web-shots.ts";

test("ring: a picture taken just after the page joins under that visit's name; one taken for another page does not", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ring-"));
  const ring = path.join(dir, "web-shots");
  const ws = (slug: string) => path.join(dir, slug, "workspace");
  const shoot = async (slug: string, at: Date) => {
    await mkdir(path.join(ws(slug), "screenshots"), { recursive: true });
    const f = path.join(ws(slug), "screenshots", "current.png");
    await writeFile(f, "png");
    await utimes(f, at, at);
  };
  const opened = "2026-10-31T11:50:00";
  await shoot("lead-gen", new Date(2026, 9, 31, 11, 50, 20)); // 20 s after its page
  await shoot("scout", new Date(2026, 9, 31, 11, 52, 30)); // 2.5 min after: a picture of something else
  await syncRing(ring, [
    { slug: "lead-gen", ws: ws("lead-gen"), lastValid: opened },
    { slug: "scout", ws: ws("scout"), lastValid: opened },
    { slug: "the-ceo", ws: ws("the-ceo"), lastValid: opened }, // no picture at all (a text-only page)
  ]);
  assert.deepEqual(await readdir(ring), [shotName("lead-gen", opened)]);
  assert.equal(shotName("lead-gen", opened), "lead-gen-20261031T115000.png");
});

test("ring: keeps the newest 12; the route's name check refuses anything else", async () => {
  const ring = await mkdtemp(path.join(tmpdir(), "ring-keep-"));
  for (let i = 0; i < 15; i++) {
    const f = path.join(ring, shotName("lead-gen", `2026-10-31T11:${String(10 + i).padStart(2, "0")}:00`));
    await writeFile(f, "png");
    const at = new Date(2026, 9, 31, 11, 10 + i, 30);
    await utimes(f, at, at);
  }
  await syncRing(ring, []);
  const left = (await readdir(ring)).sort();
  assert.equal(left.length, RING_KEEP);
  assert.equal(left[0], "lead-gen-20261031T111300.png", "the three oldest went");
  assert.ok(isShotName("lead-gen-20261031T111300.png"));
  for (const bad of ["../keys/x.png", "lead-gen.png", "a/b-20261031T111300.png", "x-20261031T111300.png.txt"]) assert.equal(isShotName(bad), false, bad);
});

test("rendered pictures (queue 41): a file named with the address hash attaches to its page first, else the visit's copy", async () => {
  // @ts-ignore TS5097
  const { shotFor, urlHash } = await import("../lib/web-shots.ts");
  const page = { slug: "lead-gen", ts: "2026-10-31T11:50:00", url: "https://florist.example/" };
  assert.equal(urlHash(page.url), "0ac7d852", "the same 8 hex as Python's sha1");
  const rendered = `scout-20261031T115500-${urlHash(page.url)}.png`; // rendered from Scout's later visit of the same address
  assert.equal(shotFor(new Set([rendered, shotName("lead-gen", page.ts)]), page), rendered, "the address hash wins");
  assert.equal(shotFor(new Set([shotName("lead-gen", page.ts)]), page), shotName("lead-gen", page.ts));
  assert.equal(shotFor(new Set(["lead-gen-20261031T115000-ffffffff.png"]), page), null);
  assert.ok(isShotName(rendered));
});
