// "This week in the family" on the dashboard (creatorCC queue 381): the newest week, its public link, nothing on junk.
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error TS5097
import { weekOf } from "../lib/family-week.ts";

test("the newest week by its last day, with the public post's link", () => {
  const w = weekOf(
    [
      { slug: "2026-11-01", to: "2026-11-01", title: "Older", summary: "a" },
      { slug: "2026-11-08", to: "2026-11-08", title: "This week in the family: 2 November to 8 November 2026", summary: "37 leads" },
      { slug: 3, title: "bad" },
    ],
    "https://blog.example/",
  );
  assert.deepEqual(w, { title: "This week in the family: 2 November to 8 November 2026", summary: "37 leads", url: "https://blog.example/family-week/2026-11-08", to: "2026-11-08" });
  assert.equal(weekOf([]), null);
  assert.equal(weekOf({ weeks: [] }), null);
});
