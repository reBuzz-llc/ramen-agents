import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error TS5097
import { changeVerdicts, newFinds, parseFinds, readVerdicts, verdictFor, withMark } from "../lib/provider-finds.ts";

const MD = `# Free AI providers and tools the scout has found

## Speka

Found 2026-09-17. Suggested key file: \`~/bots/common-data/keys/speka.key\`.

- **Endpoint:** https://speka.me/v1
- **Free terms:** $1 of included usage, no card
- **Models:** meta/llama-3.3-70b-instruct, openai/gpt-oss-120b

Real free tier with no card.

Sources:
- https://speka.me/models

## Newcomer AI

Found 2026-11-10. Suggested key file: \`~/bots/common-data/keys/newcomer-ai.key\`.

- **Endpoint:** https://api.newcomer.example/v1 (OpenAI-compatible)
- **Free terms:** 100 calls a day

Sources:
- https://newcomer.example/pricing.

## 2026-11-09 (owner): a note

## Speka

Found 2026-10-01 again.

- **Free terms:** $1 a month, 10 requests a minute
`;

test("the Scout's sections: key name, first date, endpoint, terms, models, sources; a name found twice is one find", () => {
  const f = parseFinds(MD);
  assert.deepEqual(f.map((x: { name: string }) => x.name), ["Speka", "Newcomer AI"]);
  const speka = f[0];
  assert.equal(speka.slug, "speka");
  assert.equal(speka.found, "2026-09-17");
  assert.equal(speka.free, "$1 a month, 10 requests a minute");
  assert.equal(f[1].endpoint, "https://api.newcomer.example/v1");
  assert.deepEqual(f[1].sources, ["https://newcomer.example/pricing"]);
});

test("new finds are the unmarked ones, newest first; a mark is matched by key name or name and replaced in place", () => {
  const finds = parseFinds(MD);
  const file = { version: 1 as const, providers: [], tests: {} };
  assert.deepEqual(newFinds(finds, file, new Set(["speka"])).map((x: { slug: string; hasKey: boolean }) => [x.slug, x.hasKey]), [["newcomer-ai", false], ["speka", true]]);
  assert.match(String(withMark(file, { name: "Newcomer AI", slug: "newcomer-ai", verdict: "usable", note: " " })), /short note/);
  assert.match(String(withMark(file, { name: "x", slug: "../etc", verdict: "usable", note: "n" })), /key name/);
  const one = withMark(file, { name: "Newcomer AI", slug: "newcomer-ai", verdict: "usable", note: "Answered our test", url: "https://newcomer.example/" }, new Date("2026-11-12T10:00:00Z"));
  assert.equal(typeof one, "object");
  const v = (one as { providers: { status?: string; by: string; decided_at: string }[] }).providers[0];
  assert.deepEqual([v.status, v.by, v.decided_at], ["verified", "Owner", "2026-11-12T10:00:00"]);
  assert.deepEqual(newFinds(finds, one as never, new Set()).map((x: { slug: string }) => x.slug), ["speka"]);
  const two = withMark(one as never, { name: "Newcomer AI", slug: "newcomer-ai", verdict: "unusable", note: "Asked for a card" });
  assert.deepEqual((two as { providers: { verdict: string; status?: string }[] }).providers.map((p) => [p.verdict, p.status]), [["unusable", undefined]]);
  assert.equal(verdictFor({ name: "Google Gemini", slug: "google-gemini" }, [{ name: "Google Gemini (AI Studio)", slug: "gemini" }] as never)?.slug, "gemini");
});

test("the marks file is changed under its lock and read back", async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "finds-")), "provider-verdicts.json");
  assert.deepEqual((await readVerdicts(file)).providers, []);
  await changeVerdicts(file, (f) => withMark(f, { name: "Speka", slug: "speka", verdict: "usable", note: "ok" }));
  assert.equal(JSON.parse(await readFile(file, "utf8")).providers[0].slug, "speka");
  assert.equal(await changeVerdicts(file, (f) => withMark(f, { name: "Speka", slug: "speka", verdict: "usable", note: "" })), "say why in a short note: it goes on the blog page");
});
