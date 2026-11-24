import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cleanReason, groupOf, markLine, needsConfirm, parseList, suggestable, testOutcome, testRequest, usedBy, type ProviderEntry,
  // @ts-expect-error TS5097
} from "../lib/providers-list.ts";

const base: ProviderEntry = {
  name: "groq", who: "Groq", use: "model", key_file: "groq.key", add_key: "sh scripts/add-key.sh groq", where: "https://console.groq.com/keys",
  status: "chain", free: true, card: "Free.", added: "2026-11-14", changed: "2026-11-21", mark: "usable", mark_by: "maintainers",
  mark_date: "2026-11-06", mark_note: "", test: { kind: "models", url: "https://api.groq.com/openai/v1/models", auth: "bearer" },
};
const e = (over: Partial<ProviderEntry>): ProviderEntry => ({ ...base, ...over });

test("each provider lands in one group: removed, unusable and set aside before chain, unmarked as listed", () => {
  assert.equal(groupOf(base), "chain");
  assert.equal(groupOf(e({ status: "removed", mark: "unusable" })), "removed");
  assert.equal(groupOf(e({ mark: "unusable" })), "unusable");
  assert.equal(groupOf(e({ mark: "rejected" })), "set-aside");
  assert.equal(groupOf(e({ status: "opt-in", mark: null })), "listed");
  assert.equal(groupOf(e({ status: "opt-in", free: false })), "paid");
  assert.equal(groupOf(e({ status: "opt-in" })), "free");
});

test("the mark line says who judged it and when; a set-aside row never names a judge", () => {
  assert.equal(markLine(e({ mark: "unusable", mark_by: "owner", mark_date: "2026-11-18", mark_note: "Pay-as-you-go from the first call." })),
    "Unusable (owner, 2026-11-18): Pay-as-you-go from the first call.");
  assert.equal(markLine(e({ mark: "rejected", mark_by: "maintainers", mark_date: "2026-11-06", mark_note: "Asked for a card." })),
    "Set aside by the maintainers (2026-11-06): Asked for a card.");
  assert.equal(markLine(e({ mark: null })), "Listed, not judged yet.");
});

test("nothing marked unusable or set aside is suggested, and it needs a confirm before a key", () => {
  assert.equal(suggestable(base), true);
  for (const mark of ["unusable", "rejected"] as const) {
    assert.equal(suggestable(e({ mark })), false);
    assert.equal(needsConfirm(e({ mark })), true);
  }
  assert.equal(suggestable(e({ free: false })), false);
  assert.equal(suggestable(e({ add_key: "" })), false);
  assert.equal(needsConfirm(e({ mark: null })), false);
  assert.equal(suggestable(e({ mark: null })), false, "an unjudged provider is never suggested");
});

test("a malformed entry is left out and named", () => {
  const out = parseList({ providers: [base, { ...base, name: "bad", key_file: "other.key" }, { ...base, name: "x2", mark: "great" }] });
  assert.deepEqual(out.entries.map((x: ProviderEntry) => x.name), ["groq"]);
  assert.deepEqual(out.skipped, ["bad", "x2"]);
  assert.deepEqual(parseList({}).skipped, ["providers.json has no providers list"]);
});

test("a key test is a GET of the free read with the key in a header; a query key only where the spec says so; no spec, no call", () => {
  assert.deepEqual(testRequest(base.test, "k1"), { url: "https://api.groq.com/openai/v1/models", headers: { authorization: "Bearer k1" } });
  assert.deepEqual(testRequest({ kind: "models", url: "https://x.example/v1/models", auth: "x-api-key" }, "k1")?.headers, { "x-api-key": "k1" });
  assert.deepEqual(testRequest({ kind: "models", url: "https://g.example/v1beta/models", auth: "header:x-goog-api-key" }, "k1")?.headers, { "x-goog-api-key": "k1" });
  assert.equal(testRequest({ kind: "models", url: "https://q.example/v1/account", auth: "query:key" }, "k1")?.url, "https://q.example/v1/account?key=k1");
  assert.equal(testRequest({ kind: "none" }, "k1"), null);
  assert.equal(testRequest({ kind: "models", url: "http://plain.example/models", auth: "bearer" }, "k1"), null);
  assert.equal(testRequest({ kind: "models", url: "https://x.example/models", auth: "cookie" }, "k1"), null);
});

test("an answer in words: 2xx works, 401/403 a wrong key, anything else saved, not tested", () => {
  assert.equal(testOutcome("Groq", 200).level, "works");
  assert.equal(testOutcome("Groq", 401, "bad key").level, "rejected");
  assert.equal(testOutcome("Groq", 429).level, "no-quota");
  assert.match(testOutcome("Groq", 500).message, /^Saved, not tested/);
});

test("a provider's error text never carries the key or anything key-like", () => {
  const key = ["made", "up", "x".repeat(28)].join("-"); // built here, so no file holds a key-shaped string
  const why = cleanReason(JSON.stringify({ error: { message: `Invalid key ${key}, token ${"y".repeat(30)}` } }), key);
  assert.ok(!why.includes(key) && !/[A-Za-z0-9_-]{24,}/.test(why), why);
});

test("used by: the chain, the search engines, or a setting that names the key file", () => {
  const members = [
    { name: "Lead Gen", chain: ["zai", "groq"], engines: ["searxng"], strings: ["~/bots/common-data/keys/quickemailverification.key"] },
    { name: "The CEO", chain: ["zai"], engines: ["searxng", "tavily"], strings: [] },
  ];
  assert.deepEqual(usedBy(base, members), ["Lead Gen"]);
  assert.deepEqual(usedBy(e({ name: "tavily", key_file: "tavily.key", use: "search" }), members), ["The CEO"]);
  assert.deepEqual(usedBy(e({ name: "quickemailverification", key_file: "quickemailverification.key", use: "email-check" }), members), ["Lead Gen"]);
  assert.deepEqual(usedBy(e({ name: "cerebras", key_file: "cerebras.key" }), members), []);
});

test("the route saves only after the Gemini refusal and the confirm for a marked provider; delete moves, never erases", () => {
  const route = readFileSync(new URL("../app/api/settings/provider-list/route.ts", import.meta.url), "utf8");
  const save = route.slice(route.indexOf('body.action === "save"'));
  assert.ok(save.indexOf("needsTermsScript(p.name)") < save.indexOf("await saveProviderKey"));
  assert.ok(save.indexOf("needsConfirm(p)") < save.indexOf("await saveProviderKey"));
  const store = readFileSync(new URL("../lib/providers-store.ts", import.meta.url), "utf8");
  const del = store.slice(store.indexOf("export async function deleteProviderKey"), store.indexOf("export async function testProviderKey"));
  assert.ok(del.includes("rename(") && !/\bunlink|\brm\(/.test(del));
  const t = store.slice(store.indexOf("export async function testProviderKey"));
  assert.ok(!/method:\s*"POST"|chat\/completions/.test(t), "a key test is never a completion");
});
