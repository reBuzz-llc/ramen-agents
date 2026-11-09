// The public world: the masking, the signed link, the rate limit and the server's three routes.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
// @ts-expect-error TS5097
import { leaks, makeLimiter, makeMasker, maskDeep, publicState, routeOf, shortBusiness, signToken, verifyToken } from "../lib/world-public.ts";
// @ts-expect-error TS5097
import { FORBIDDEN, handler, stateFrom } from "../scripts/world-public.ts";

const mask = makeMasker({
  leads: [
    { business: "Cobot Partners LLC", contact: "Jane Doe" },
    { business: "Sasson's Yarn Shop", contact: null },
    { business: "Udonis", contact: "Al" }, // one word, too short: left alone
  ],
  team: ["Anna Example"],
});

test("lead names become first word and initial; contacts and teammates their first name", () => {
  assert.equal(shortBusiness("Cobot Partners LLC"), "Cobot P.");
  assert.equal(shortBusiness("Udonis"), "Udonis");
  assert.equal(shortBusiness("Joe & Pat's"), "Joe P."); // "&" has no letter: the next word's initial
  assert.equal(mask("drafted an email for 'Cobot Partners LLC' to Jane Doe"), "drafted an email for 'Cobot P.' to Jane");
  assert.equal(mask("updated lead 'sasson's yarn shop'"), "updated lead 'Sasson's Y.'");
  assert.equal(mask("Anna Example sent it"), "Anna sent it");
  assert.equal(mask("Udonis is fine"), "Udonis is fine");
});

test("no email address, phone number or web address survives; dates and times do", () => {
  const out = mask("wrote hi@cobot.example and +1 (718) 555-1000, read https://cobot.com/about and www.x.org and pamhvac.com on 2026-11-09 at 18:25");
  assert.equal(out, "wrote [email] and [phone], read [link] and [link] and [link] on 2026-11-09 at 18:25");
  assert.equal(leaks(out), false);
  assert.equal(mask("last call api.z.ai/glm-4.5-flash · 28s"), "last call glm-4.5-flash · 28s");
  assert.equal(mask("opened blckalpaca.at · ai agents page; read tick-report.json and v1.2"), "opened [link] · ai agents page; read tick-report.json and v1.2");
  assert.equal(leaks("call 7185551000"), true);
  assert.equal(leaks({ ts: "2026-11-09T18:25:52", share: 0.0229007633587786 }), false);
});

test("address keys are emptied, times kept, the Board's private parts dropped, Feeds trimmed", () => {
  const m = maskDeep({ url: "https://x.com", shot: "/api/shot?bot=a", ts: "2026-11-09T18:25:52", title: "Cobot Partners LLC home", n: 3 }, mask);
  assert.deepEqual(m, { url: "", shot: "", ts: "2026-11-09T18:25:52", title: "Cobot P. home", n: 3 });
  const st = publicState(
    {
      board: { at: "2026-11-09T10:00:00", cards: [{ slug: "ow", on: "writing for Cobot Partners LLC" }], decisions: [{ id: "d1", text: "x" }], proposals: [{ id: "p" }], chat: { ow: { owner: "secret" } }, replies: { ow: "hi" }, portalLocal: { url: "https://t.example" } },
      web: { recent_pages: [{ url: "https://cobot.com", title: "Cobot Partners LLC", shot: "/api/x" }] },
      feeds: { ow: { thought: "mail jane@cobot.com", feed: Array.from({ length: 30 }, (_, i) => ({ ts: "2026-11-09T10:00:00", words: `step ${i}`, verdict: "allowed", reason: null, page: "x" })) as never }, gone: null },
      trial: null,
      tick: { text: "Last tick 10:00 (3 min ago)", stale: false },
    },
    mask,
  );
  assert.deepEqual(st.board.decisions, []);
  assert.deepEqual(st.board.proposals, []);
  assert.deepEqual(st.board.chat, {});
  assert.deepEqual(st.board.replies, {});
  assert.equal(st.board.portalLocal, null);
  assert.equal((st.board.cards as { on: string }[])[0].on, "writing for Cobot P.");
  assert.deepEqual((st.web as { recent_pages: unknown[] }).recent_pages[0], { url: "", title: "Cobot P.", shot: "" });
  assert.equal(st.feeds.ow.feed.length, 20);
  assert.equal(st.feeds.ow.thought, "mail [email]");
  assert.equal("page" in st.feeds.ow.feed[0], false);
  assert.equal("gone" in st.feeds, false);
  assert.equal(leaks(st), false);
});

test("a signed link: round trip, expiry, tampering, too long", () => {
  const now = 1_800_000_000;
  const t = signToken("s3cret-s3cret-s3cret-s3cret-s3cret!", "Anna Example", now + 7200);
  assert.deepEqual(verifyToken("s3cret-s3cret-s3cret-s3cret-s3cret!", t, now), { person: "Anna Example", exp: now + 7200 });
  assert.equal(verifyToken("s3cret-s3cret-s3cret-s3cret-s3cret!", t, now + 7200), null); // expired
  assert.equal(verifyToken("another-secret-another-secret-123", t, now), null);
  const [p, sig] = t.split(".");
  const forged = `${Buffer.from(`${now + 7200}.Someone Else`).toString("base64url")}.${sig}`;
  assert.equal(verifyToken("s3cret-s3cret-s3cret-s3cret-s3cret!", forged, now), null);
  assert.equal(verifyToken("s3cret-s3cret-s3cret-s3cret-s3cret!", `${p}.${sig}.x`, now), null);
  assert.equal(verifyToken("s3cret-s3cret-s3cret-s3cret-s3cret!", signToken("s3cret-s3cret-s3cret-s3cret-s3cret!", "A", now + 86400), now), null); // a day: too long
  assert.equal(verifyToken("s3cret-s3cret-s3cret-s3cret-s3cret!", "", now), null);
  // the vector the portal's lib/world-share.ts test checks too: both sides sign alike
  assert.equal(signToken("k", "Anna", 1800000000), "MTgwMDAwMDAwMC5Bbm5h.T0QtCt8HFuAQW_8i0CXQt0j0eiJjME-V6OpJ1ec-Ctw");
});

test("60 a minute per address, then refused until the window passes", () => {
  const allow = makeLimiter(60, 60_000);
  for (let i = 0; i < 60; i++) assert.equal(allow("1.2.3.4", 1000 + i), true);
  assert.equal(allow("1.2.3.4", 2000), false);
  assert.equal(allow("5.6.7.8", 2000), true);
  assert.equal(allow("1.2.3.4", 62_000), true);
});

test("three routes, and 404 for every other path", () => {
  assert.equal(routeOf("GET", "/"), "page");
  assert.equal(routeOf("GET", "/state"), "state");
  for (const p of ["/api/board", "/api/controls", "/state/x", "/index.html", "/_next/static/a.js"]) assert.equal(routeOf("GET", p), null);
  assert.equal(routeOf("POST", "/state"), null);
});

test("the server: 403 without a link, the page with one (cookie, frame rule), /state gzipped, 404, 429", async () => {
  const secret = "test-secret-test-secret-test-secret";
  const lines: string[] = [];
  let reads = 0;
  const h = handler({ secret, page: async () => "<html>world</html>", state: async () => (reads++, JSON.stringify({ at: "x" })), log: (l: string) => lines.push(l), limit: 5 });
  const server = createServer((req, res) => void h(req, res));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const t = signToken(secret, "Anna Example", Math.floor(Date.now() / 1000) + 3600);
    const bad = await fetch(`${base}/`);
    assert.equal(bad.status, 403);
    assert.match(await bad.text(), new RegExp(FORBIDDEN.slice(0, 30)));
    const page = await fetch(`${base}/?t=${t}`);
    assert.equal(page.status, 200);
    assert.equal(await page.text(), "<html>world</html>");
    assert.match(page.headers.get("set-cookie") ?? "", /^world_t=[\w.-]+; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=None; Partitioned$/);
    assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
    const st = await fetch(`${base}/state`, { headers: { "x-world-token": t, "accept-encoding": "gzip" } });
    assert.equal(st.status, 200);
    assert.deepEqual(await st.json(), { at: "x" }); // fetch un-gzips
    assert.equal((await fetch(`${base}/state`)).status, 403);
    assert.equal((await fetch(`${base}/api/board?t=${t}`)).status, 404);
    assert.equal((await fetch(`${base}/`)).status, 429); // the sixth request from this address in a minute
    assert.equal(lines.some((l) => l.includes(t) || l.includes("?t=")), false); // no token in the log
    assert.ok(lines.some((l) => / GET \/ 200 Anna /.test(l)));
    assert.equal(reads, 1);
  } finally {
    server.close();
  }
});

test("the state is fetched at most every 15 s, again after a failure", async () => {
  let n = 0;
  let clock = 0;
  const get = stateFrom("http://dash", (async () => (n++, new Response(n === 2 ? "no" : `{"n":${n}}`, { status: n === 2 ? 500 : 200 }))) as typeof fetch, () => clock);
  assert.equal(await get(), '{"n":1}');
  clock = 10_000;
  assert.equal(await get(), '{"n":1}');
  clock = 16_000;
  await assert.rejects(get());
  assert.equal(await get(), '{"n":3}');
});
