// Peek's port of the Validator's template rules runs the same cases (tests/fixtures/template-rules-cases.json,
// copied from the fleet's validator/tests/fixtures/; refresh it when the Validator's changes).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { changeRatio, groupOf, groupWords, isSmallFix, makeTemplate, SMALL_FIX, textKey } from "@/lib/template-rules";

const F = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "template-rules-cases.json"), "utf8"));

describe("the shared template rules", () => {
  it("the same small-fix line", () => expect(SMALL_FIX).toBe(F.small_fix_below));
  for (const c of F.cases)
    it(c.name, () => {
      expect(Math.round(changeRatio(c.before, c.after, c.row) * 10000) / 10000).toBe(c.ratio);
      expect(isSmallFix(c.before, c.after, c.row)).toBe(c.small_fix);
      expect(groupOf(c.row)).toBe(c.group);
      expect(groupWords(c.group, c.group_words_n)).toBe(c.group_words);
      const [template, used] = makeTemplate(c.after, c.row);
      expect(template).toBe(c.template);
      expect(used).toEqual(c.placeholders);
      expect(textKey(c.after)).toBe(c.text_key);
    });
});
