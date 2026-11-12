// Run: npm test. The Allowance list (creatorCC queue 230): the chain's use against each free tier, and the keys out of it.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore TS5097
import { allowanceOf, daysLeft, nextMonthFirst, parseConfig } from "../lib/allowance.ts";

const CONFIG = `
[model]
provider_chain = ["zai", "gemini", "groq", "speka", "gonka-broker", "ollama-cloud"]  # the one chain
[browser]
langsearch_per_day = 100
[model.providers.groq]
base_url = "https://api.groq.com/openai/v1"
calls_per_day = 900
[model.providers.speka]
base_url = "https://speka.me/v1"
calls_per_day = 30
[model.providers.zai]
base_url = "https://api.z.ai/api/paas/v4"
calls_per_day = 3000
[model.providers.gonka-broker]
base_url = "https://proxy.gonkabroker.com/v1"
calls_per_day = 15
[model.providers.ollama-cloud]
base_url = "https://ollama.com/v1"
calls_per_day = 60
[model.providers.openai]
base_url = "https://api.openai.com/v1"
`;
const CALLS = {
  day: "2026-11-06",
  counts: { "api.z.ai": 1200, gemini: 250, "api.groq.com": 48, "speka.me": 20, "ollama.com": 56 },
  usage: { "api.groq.com": { decide: [48, 150000, 30000] as [number, number, number] }, "ollama.com": { decide: [56, 400000, 10000] as [number, number, number] } },
  health: {
    "api.z.ai": { last_ok: "2026-11-06T12:57:27", last_fail: "2026-11-06T12:46:40" },
    "speka.me": { last_ok: "2026-10-30T23:00:31", last_fail: "2026-11-06T07:20:38", first_fail: "2026-11-03T15:56:29", last_reason: "empty reply" },
  },
};
const HISTORY = { since: "2026-11-05", days: { "2026-11-05": { hosts: { "proxy.gonkabroker.com": { calls: 10, tokens: 100_000 }, "inference.dahl.global": { calls: 3, tokens: 900 } } } } };
const run = (over: Partial<Parameters<typeof allowanceOf>[0]> = {}) =>
  allowanceOf({ config: CONFIG, calls: CALLS, history: HISTORY, keys: ["zai", "groq", "speka", "gonka-broker", "tavily", "quickemailverification", "dahl-inference", "openai", "peek-owner", "notion"], search: { tavily: { "2026-10-09": 1 } }, verify: { a: { at: "2026-11-06T12:50:00" }, b: { at: "2026-11-05T10:00:00", by: "sniffmail" } }, ...over }, new Date("2026-11-06T13:00:00"));

test("the config: the chain, the providers' caps, top-level numbers", () => {
  const c = parseConfig(CONFIG);
  assert.deepEqual(c.chain, ["zai", "gemini", "groq", "speka", "gonka-broker", "ollama-cloud"]);
  assert.equal(c.providers.groq.calls_per_day, "900");
  assert.equal(c.top.langsearch_per_day, "100");
  assert.equal(daysLeft("2026-11-06"), 25);
});

test("a row per chain provider: calls against the cap, Groq's daily tokens, the monthly tiers paced, dead and near", () => {
  const a = run();
  const row = (n: string) => a.chain.find((r) => r.name === n)!;
  assert.deepEqual([row("zai").calls, row("zai").callsCap, row("zai").left.calls, row("zai").status], [1200, 3000, 1800, "ok"]);
  assert.deepEqual([row("gemini").callsCap, row("gemini").used], [null, null]);
  // Groq is token-bound: 180k of 200k today is 90%, so it is near
  assert.deepEqual([row("groq").tokens, row("groq").left.tokens, row("groq").status], [180_000, 20_000, "near"]);
  // Gonka: 1M a month, 100k used on the 5th, 25 days left today: a paced 36k today
  assert.deepEqual(row("gonka-broker").tokenLimit, { per: "month", limit: 1_000_000, monthUsed: 100_000, pacedToday: 36_000 });
  // Ollama Cloud: a monthly cap of unknown size, so only its calls count: 56 of 60 is 93%
  assert.deepEqual([row("ollama-cloud").tokenLimit?.limit, row("ollama-cloud").left.tokens, row("ollama-cloud").status], [null, null, "near"]);
  assert.equal(row("speka").status, "dead");
  assert.match(row("speka").note, /^not answering since 11-03 15:56 \(empty reply\)$/);
  assert.deepEqual(a.alerts, ["groq at 90%", "speka not answering", "ollama-cloud at 93%"]);
});

test("keys out of the chain: searches and verifiers with their counts, models with their last day; no portal or notion", () => {
  const idle = run().idle;
  assert.deepEqual(idle.map((r) => r.name), ["dahl-inference", "openai", "quickemailverification", "tavily"]);
  const by = (n: string) => idle.find((r) => r.name === n)!;
  assert.deepEqual([by("tavily").lastUse, by("tavily").today, by("tavily").cap], ["2026-10-09", 0, "25 a day (the Analyst) + The CEO's by hand"]);
  assert.deepEqual([by("quickemailverification").lastUse, by("quickemailverification").today], ["2026-11-06 12:50", 1]);
  assert.deepEqual([by("dahl-inference").kind, by("dahl-inference").lastUse], ["model", "2026-11-05"]);
  assert.equal(by("openai").cap, "paid key, in no chain");
});

test("a provider table's note shows first, with the dead line after it (creatorCC queue 257)", () => {
  const config = CONFIG.replace('provider_chain = ["zai",', 'provider_chain = ["mistral", "zai",') +
    `[model.providers.mistral]\nbase_url = "https://api.mistral.ai/v1"\ncalls_per_day = 1\nnote = "1 a day until activated"\n`;
  const calls = { ...CALLS, counts: { ...CALLS.counts, "api.mistral.ai": 1 },
    health: { ...CALLS.health, "api.mistral.ai": { last_fail: "2026-11-06T07:20:39", last_reason: "empty reply" } } };
  const row = run({ config, calls }).chain.find((r: { name: string }) => r.name === "mistral");
  assert.ok(row);
  assert.equal(row!.note, "1 a day until activated · has never answered (empty reply)");
  assert.equal(row!.callsCap, 1);
});

test("allowance: each provider's calls split between the bots and the Validator's own jobs (queue 286)", async () => {
  // @ts-ignore TS5097
  const { splitOf } = await import("../lib/allowance.ts");
  assert.deepEqual(splitOf({ "Lead Gen": 300, "The CEO": 100, unnamed: 6, "validator:polish": 40, "validator:pain-refresh": 12 }, 458), { bots: 406, validator: 52 });
  assert.equal(splitOf(undefined, 458), null); // the ledger has no split yet
  assert.equal(splitOf({ "validator:polish": 40 }, 458), null); // only the Validator's entries while the bots' are not in yet
  assert.deepEqual(splitOf({ "validator:polish": 40 }, 40), { bots: 0, validator: 40 }); // the Validator made every call
  const rows = run({ calls: { ...CALLS, by_caller: { "api.z.ai": { "Lead Gen": 10, "validator:second-opinion": 3 } } } }).chain;
  assert.ok(rows.some((r: { host: string; split: unknown }) => r.host === "api.z.ai" && JSON.stringify(r.split) === JSON.stringify({ bots: 10, validator: 3 })));
});

test("allowance: the other free tiers pass through, and those at 80% or more warn on the ticker (queue 304)", async () => {
  // @ts-ignore TS5097
  const { otherAlerts } = await import("../lib/allowance.ts");
  const rows = [
    { name: "Supabase", what: "database size (the portal's primary)", used: 420, limit: 500, unit: "MB", resets: "", status: "near", how: "" },
    { name: "Vercel Hobby", what: "fast data transfer", used: null, limit: 100, unit: "GB/month", resets: "", status: "unknown", how: "not measurable" },
    { name: "Kaggle", what: "GPU hours", used: 6, limit: 30, unit: "hours/week", resets: "", status: "ok", how: "" },
  ] as const;
  assert.deepEqual(otherAlerts([...rows]), ["Supabase database size (the portal's primary) at 84%"]);
  const a = run({ other: { at: "2026-11-06T20:00:00", rows: [...rows] } });
  assert.equal(a.other.length, 3);
  assert.equal(a.otherAt, "2026-11-06T20:00:00");
  assert.ok(a.alerts.includes("Supabase database size (the portal's primary) at 84%"));
  assert.deepEqual(run().other, []); // no file yet: nothing, and no alert
});

test("allowance: Tavily counts The CEO's and the Analyst's files together; LangSearch and Parallel share Lead Gen's searches; ezverify 200 a month (queue 329)", async () => {
  // @ts-ignore TS5097
  const { mergeDays } = await import("../lib/allowance.ts");
  assert.deepEqual(mergeDays([{ "2026-11-08": 2, "2026-11-07": 1 }, { "2026-11-08": 5 }, {}]), { "2026-11-08": 7, "2026-11-07": 1 });
  const a = run({
    keys: ["tavily", "langsearch", "parallel", "ezverify"],
    search: { tavily: mergeDays([{ "2026-11-06": 1 }, { "2026-11-06": 4 }]), langsearch: { "2026-11-06": 3 }, parallel: {} },
    verify: { a: { at: "2026-11-06T09:00:00", by: "ezverify" }, b: { at: "2026-11-06T10:00:00", by: "ezverify" }, c: { at: "2026-11-06T11:00:00" } },
  });
  const by = (n: string) => a.idle.find((r: { name: string }) => r.name === n)!;
  assert.deepEqual([by("tavily").today, by("tavily").cap], [5, "25 a day (the Analyst) + The CEO's by hand"]);
  assert.match(by("tavily").note, /Research Analyst.*25 a day.*The CEO/);
  assert.deepEqual([by("langsearch").today, by("langsearch").cap, by("langsearch").note], [3, "100 a day", "a share of Lead Gen's searches by allowance left"]);
  assert.deepEqual([by("parallel").cap, by("parallel").note], ["30 a day", "a share of Lead Gen's searches by allowance left"]);
  assert.deepEqual([by("ezverify").today, by("ezverify").cap], [2, "200 a month"]);
});

test("a spent allowance (engine 2cbe08a): 'spent today' or 'spent this month' with the renew time; an old mark is ignored (queue 449)", () => {
  const withSpent = (zai: string, speka: string) =>
    run({ calls: { ...CALLS, health: { ...CALLS.health, "api.z.ai": { ...CALLS.health["api.z.ai"], spent: zai }, "speka.me": { ...CALLS.health["speka.me"], spent: speka } } } });
  const a = withSpent("2026-11-06", "2026-11");
  const row = (n: string) => a.chain.find((r) => r.name === n)!;
  assert.deepEqual([row("zai").status, row("zai").note, row("zai").health.spent], ["spent", "spent today · renews at midnight", "day"]);
  assert.deepEqual([row("speka").status, row("speka").note], ["spent", "spent this month · renews on the 1st (12-01)"]);
  assert.deepEqual(a.alerts, ["zai spent today", "groq at 90%", "speka spent this month", "ollama-cloud at 93%"]);
  // yesterday's day mark and last month's month mark no longer hold: back to the health lines
  const b = withSpent("2026-11-05", "2026-10");
  assert.equal(b.chain.find((r) => r.name === "zai")!.status, "ok");
  assert.match(b.chain.find((r) => r.name === "speka")!.note, /^not answering since/);
  assert.deepEqual([nextMonthFirst("2026-11"), nextMonthFirst("2026-12")], ["2026-12-01", "2027-01-01"]);
});
