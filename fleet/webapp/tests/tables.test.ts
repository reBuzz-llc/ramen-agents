import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
// @ts-expect-error TS5097
import { sortOrder, sortValue } from "../lib/sort-value.ts";

test("cells sort by value: numbers with commas, %, $, # and units; words; dates; empties last both ways", () => {
  const v = (xs: (string | number)[]) => xs.map(sortValue);
  const by = (xs: (string | number)[], dir: "asc" | "desc") => sortOrder(v(xs), dir).map((i: number) => xs[i]);
  assert.deepEqual(by(["1,200", "91%", "–", "$0.32", "#22", "3"], "asc"), ["$0.32", "3", "#22", "91%", "1,200", "–"]);
  assert.deepEqual(by(["1,200", "91%", "–", "$0.32", "#22", "3"], "desc"), ["1,200", "91%", "#22", "3", "$0.32", "–"]);
  assert.deepEqual(by(["groq", "Gemini", "zai", ""], "asc"), ["Gemini", "groq", "zai", ""]);
  assert.deepEqual(by(["2026-11-12 10:00", "2026-11-09", "never"], "desc"), ["2026-11-12 10:00", "2026-11-09", "never"]);
  assert.deepEqual(by(["2 d", "3 h", "45 min"], "asc"), ["45 min", "3 h", "2 d"]);
  assert.deepEqual(by(["12k", "900", "1.5m"], "asc"), ["900", "12k", "1.5m"]);
  assert.deepEqual(by(["b", "a", "b"], "asc"), ["a", "b", "b"]);
  assert.equal(sortValue(42).num, 42);
});

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(p)));
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

test("every table under app/ is a SortableTable (owner, 2026-11-12: now and in the future); a plain one says data-nosort", async () => {
  const root = path.join(import.meta.dirname, "..", "app");
  const bare: string[] = [];
  for (const f of await files(root)) {
    if (f.endsWith("sortable-table.tsx")) continue;
    (await readFile(f, "utf8")).split("\n").forEach((line, i) => {
      if (/<table[\s>]/.test(line) && !/data-nosort/.test(line)) bare.push(`${path.relative(root, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(bare, [], "use <SortableTable> from app/sortable-table.tsx (or data-nosort with a reason)");
});
