import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error TS5097
import { judgeText, lanesToday, parseModelsQuality, pct } from "../lib/models-quality.ts";

test("the Validator's per-model file: nulls kept as not logged, junk rows dropped", () => {
  const q = parseModelsQuality({
    at: "2026-11-12T22:00:00", days: 7, since: "2026-11-05T22:00:00", data_from: "2026-11-12",
    models: [
      { model: "gemini/gemini-3.6-flash", lane: "quality", provider: "gemini", members: { "outreach-writer": 40, "the-ceo": 12, x: "y" }, written: 52, refused: 6, refused_share: 0.115, judge_yes: 30, judge_no: 10, second_opinion_disagree: 3, redo_rate: 0.08 },
      { model: "groq/openai/gpt-oss-120b", lane: "bulk", provider: "groq", members: {}, written: 300, refused: 60, refused_share: 0.2, judge_yes: null, judge_no: null, second_opinion_disagree: null, redo_rate: null },
      { lane: "bulk" },
    ],
  });
  assert.equal(q!.models.length, 2);
  const [g, b] = q!.models;
  assert.deepEqual(g.members, { "outreach-writer": 40, "the-ceo": 12 });
  assert.deepEqual([pct(g.refusedShare), judgeText(g), pct(g.redoRate)], ["12%", "30 / 10 (75% yes)", "8%"]);
  assert.deepEqual([pct(b.redoRate), judgeText(b), b.disagree], ["–", "–", null]);
  assert.equal(parseModelsQuality(null), null);
});

test("today's lanes from the ledger: quality first, most calls first", () => {
  assert.deepEqual(lanesToday({ lanes: { bulk: { "groq/x": 90, "zai/y": 200 }, quality: { "gemini/z": 40, "speka/w": 0 } } }),
    [{ lane: "quality", model: "gemini/z", calls: 40 }, { lane: "bulk", model: "zai/y", calls: 200 }, { lane: "bulk", model: "groq/x", calls: 90 }]);
  assert.deepEqual(lanesToday({}), []);
});
