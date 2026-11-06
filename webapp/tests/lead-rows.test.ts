// The dashboard's Leads reads from either store: Notion pages and the portal leads become the
// same rows and the same Reports counts; The portal is read page by page with the key. Fixture: tests/fixtures/portal-leads.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// @ts-ignore TS5097
import { fromNotion, fromPortal, readAllPortal, summarise } from "../lib/lead-rows.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/portal-leads.json", import.meta.url), "utf8")) as { pages: { leads: Record<string, unknown>[]; next: number; more: boolean }[] };
const portalRows = fixture.pages.flatMap((p) => p.leads);

// The same three leads as Notion pages: Status a multi-select mixing the two tracks, as the board has it.
const sel = (name: string | null) => ({ type: "select", select: name ? { name } : null });
const multi = (...names: string[]) => ({ type: "multi_select", multi_select: names.map((name) => ({ name })) });
const txt = (s: string | null) => ({ type: "rich_text", rich_text: s ? [{ plain_text: s }] : [] });
const url = (s: string | null) => ({ type: "url", url: s });
const notionPages = [
  { Business: { type: "title", title: [{ plain_text: "Acme Bakery" }] }, Website: url("https://acmebakery.example"), Industry: txt("Bakery"), Status: multi("Email Sent", "WhatsApp Verified"), Result: sel("Replied"), "Result date": { type: "date", date: { start: "2026-11-01" } }, "Draft email": txt("Hi Maria"), "Draft Whatsapp msg": txt(null), Whatsapp: url("https://wa.me/1718"), "google map location": url(null) },
  { Business: { type: "title", title: [{ plain_text: "Bravo Barbers" }] }, Website: url("https://bravo.example"), Industry: txt("Barbershop"), Status: multi(), Result: sel(null), "Result date": { type: "date", date: null }, "Draft email": txt("skip: chain"), "Draft Whatsapp msg": txt(null), Whatsapp: url(null), "google map location": url("https://maps.example/b") },
  { Business: { type: "title", title: [{ plain_text: "Cedar Dental" }] }, Website: url(null), Industry: txt("Dental clinic"), Status: multi("Ready to Send Email"), Result: sel(null), "Result date": { type: "date", date: null }, "Draft email": txt("Hi Cedar"), "Draft Whatsapp msg": txt("Hello"), Whatsapp: url(null), "google map location": url(null) },
];

test("Notion pages and portal leads become the same rows", () => {
  const a = portalRows.map(fromPortal);
  const b = notionPages.map((p) => fromNotion(p as never, ""));
  const strip = (r: { edited: string }) => ({ ...r, edited: "" });
  assert.deepEqual(a.map(strip), b.map(strip));
  assert.deepEqual(a[0].status, ["Email Sent", "WhatsApp Verified"]);
});

test("the Reports counts are the same from both stores", () => {
  const now = new Date("2026-11-02T12:00:00Z").getTime();
  const src = () => "Web search or added by hand";
  const fromP = summarise(portalRows.map(fromPortal), src, "Draft email", now);
  const fromN = summarise(notionPages.map((p) => fromNotion(p as never, "")), src, "Draft email", now);
  assert.deepEqual(fromP, fromN);
  assert.deepEqual(fromP.pipeline, { leads: 3, drafted: 2, sent: 1, replied: 1, meeting: 0, client: 0 });
  assert.deepEqual(fromP.drafts, { column: "Draft email", stage: "", drafted: 2, skipped: 1, waiting: 0, unsent: 1 });
  assert.equal(fromP.sent, 1);
  assert.equal(fromP.whatsappVerified, 1);
  assert.equal(fromP.repliesWeek, 1);
  assert.deepEqual([fromP.whatsapp, fromP.whatsappDrafts, fromP.mapLinks], [1, 1, 1]);
});

test("The portal is read page by page with the key, and a refusal says why", async () => {
  const asked: string[] = [];
  const pages = [...fixture.pages];
  const ok = (async (u: string, init?: RequestInit) => {
    asked.push(`${u} ${(init?.headers as Record<string, string>).Authorization}`);
    return new Response(JSON.stringify(pages.shift()), { status: 200 });
  }) as never;
  const rows = await readAllPortal("https://portal.example", "portal_test_key", ok);
  assert.equal(rows.length, 3);
  assert.deepEqual(asked, ["https://portal.example/v1/boards/leads/rows?since=0&limit=500 Bearer portal_test_key", "https://portal.example/v1/boards/leads/rows?since=2&limit=500 Bearer portal_test_key"]);
  const refused = (async () => new Response(JSON.stringify({ error: { code: "unauthorized", message: "that key is not active" } }), { status: 401 })) as never;
  await assert.rejects(readAllPortal("https://portal.example", "old", refused), /HTTP 401: that key is not active/);
});

test("readPortalCached: a full pull, then only what changed; 304 pulls nothing; archived leads leave the cache", async () => {
  // @ts-ignore TS5097
  const { readPortalCached } = await import("../lib/lead-rows.ts");
  const calls: { url: string; inm: string | null }[] = [];
  const respond = (pages: Record<number, { leads: object[]; next: number; more: boolean }>, status = 200) => async (u: string, init?: RequestInit) => {
    const since = Number(new URL(u).searchParams.get("since"));
    calls.push({ url: u, inm: new Headers(init?.headers).get("If-None-Match") });
    if (status === 304) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(pages[since]), { status: 200, headers: { etag: `W/"leads-${pages[since].next}"` } });
  };
  const now = Date.parse("2026-11-06T18:00:00Z");
  const first = await readPortalCached("https://portal.example", "k", null, now, respond({ 0: { leads: [{ id: "a", business: "A" }, { id: "b", business: "B" }], next: 2, more: false } }));
  assert.equal(first.leads.length, 2);
  assert.match(calls[0].url, /since=0&limit=500&archived=true&fields=business,/);
  assert.equal(first.cache.rev, 2);
  // an hour later: only since=2 is asked, with the ETag; b archived, c new
  const second = await readPortalCached("https://portal.example", "k", first.cache, now + 3600e3, respond({ 2: { leads: [{ id: "b", archived: true }, { id: "c", business: "C" }], next: 4, more: false } }));
  assert.equal(calls[1].inm, 'W/"leads-2"');
  assert.match(calls[1].url, /since=2&/);
  assert.deepEqual(second.leads.map((l: Record<string, unknown>) => String(l.id)).sort(), ["a", "c"]);
  assert.equal(second.pulled, 2);
  // nothing new: 304, nothing pulled, the cache as it was
  const third = await readPortalCached("https://portal.example", "k", second.cache, now + 7200e3, respond({}, 304));
  assert.equal(third.pulled, 0);
  assert.equal(third.leads.length, 2);
  // a day on: a full pull again
  await readPortalCached("https://portal.example", "k", third.cache, now + 25 * 3600e3, respond({ 0: { leads: [], next: 0, more: false } }));
  assert.match(calls[calls.length - 1].url, /since=0&/);
});
