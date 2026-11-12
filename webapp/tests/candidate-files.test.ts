// Lead Gen's candidate lists with the midday batch (creatorCC queue 444): both batches of a day are read and a day counts once.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error TS5097
import { batchLabel, candidateFile, recentFiles } from "../lib/candidate-files.ts";

test("the names: plain and T12, a market with hyphens; anything else is not a list", () => {
  assert.deepEqual(candidateFile("candidates-new-york-2026-11-11T12.md"), { file: "candidates-new-york-2026-11-11T12.md", market: "new-york", date: "2026-11-11", midday: true });
  assert.equal(candidateFile("candidates-new-york-2026-11-11.md")?.midday, false);
  assert.equal(candidateFile("candidates-new-york-2026-11-11T18.md"), null);
  assert.equal(candidateFile("notes.md"), null);
});

test("the last days: a day's two batches are one day, morning first; the label says midday", () => {
  const names = ["candidates-new-york-2026-11-11T12.md", "candidates-new-york-2026-11-09.md", "candidates-new-york-2026-11-10.md", "candidates-new-york-2026-11-11.md", "x.md"];
  const two = recentFiles(names, 2);
  assert.deepEqual(two.map((f: { file: string }) => f.file), ["candidates-new-york-2026-11-10.md", "candidates-new-york-2026-11-11.md", "candidates-new-york-2026-11-11T12.md"]);
  assert.deepEqual(two.slice(1).map(batchLabel), ["11-11", "11-11 midday"]);
  assert.equal(recentFiles(names, Infinity).length, 4);
});
