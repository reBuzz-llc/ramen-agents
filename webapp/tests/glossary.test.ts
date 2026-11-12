import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error TS5097
import { filterGlossary, parseGlossary } from "../lib/glossary.ts";

const RAW = {
  _note: "kept by creatorCC", updated: "2026-11-12",
  sections: [
    { title: "The engine", items: [{ term: "Ramen", what: "the engine every agent runs on (was macBot1)", since: "2026-11-12" }, { term: "", what: "no term" }] },
    { title: "Rhythms", items: [{ term: "the tick", what: "the Validator's report every 10 to 30 minutes" }, { term: "Café hour", what: "a made-up entry with an accent" }] },
    { title: "Empty", items: [] },
    "junk",
  ],
};

test("the file's sections, malformed parts left out; no file is empty", async () => {
  const g = parseGlossary(RAW);
  assert.equal(g.updated, "2026-11-12");
  assert.deepEqual(g.sections.map((s: { title: string; items: unknown[] }) => [s.title, s.items.length]), [["The engine", 1], ["Rhythms", 2]]);
  assert.equal(g.sections[1].items[0].since, "");
  assert.deepEqual(parseGlossary(null), { updated: "", sections: [] });
  const file = path.join(await mkdtemp(path.join(tmpdir(), "g-")), "glossary.json");
  await writeFile(file, JSON.stringify(RAW));
  assert.equal(parseGlossary(JSON.parse(await readFile(file, "utf8"))).sections.length, 2);
});

test("the search: every word in the term, meaning or section title, across sections, accents folded", () => {
  const s = parseGlossary(RAW).sections;
  assert.equal(filterGlossary(s, "  ").length, 2);
  assert.deepEqual(filterGlossary(s, "macbot").map((x: { title: string }) => x.title), ["The engine"]);
  assert.deepEqual(filterGlossary(s, "validator report").flatMap((x: { items: { term: string }[] }) => x.items.map((i) => i.term)), ["the tick"]);
  assert.deepEqual(filterGlossary(s, "cafe").flatMap((x: { items: { term: string }[] }) => x.items.map((i) => i.term)), ["Café hour"]);
  assert.deepEqual(filterGlossary(s, "rhythms tick").flatMap((x: { items: { term: string }[] }) => x.items.map((i) => i.term)), ["the tick"]);
  assert.deepEqual(filterGlossary(s, "nothing-like-this"), []);
});
