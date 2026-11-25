// A LinkedIn post needs the signed-in owner's Approve on its exact
// words and place, used once; a billing bench is lifted only by the owner. A machine key can propose, add and use up, never approve
// or clear. Invented people and words.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as press } from "@/app/api/approvals/route";
import { GET as readBenches, POST as benchPost } from "@/app/v1/billing-benches/route";
import { GET as readAskRoute, POST as filePost } from "@/app/v1/owner-asks/route";
import { POST as usedPost } from "@/app/v1/owner-asks/used/route";
import { mintKey } from "@/lib/api-keys";
import { sha256 } from "@/lib/crypto";
import { memoryDb, type Db } from "@/lib/db";
import { billingBenches, ownerAnswers, ownerAsks, users } from "@/lib/db/schema";
import { textHashOf } from "@/lib/owner-asks";
import { addUser, createTenant } from "@/lib/tenants";

const h = vi.hoisted(() => ({ db: null as unknown, who: null as unknown }));
vi.mock("@/lib/db", async (real) => ({ ...(await real<typeof import("@/lib/db")>()), db: async () => h.db }));
vi.mock("@/lib/auth", () => ({ me: async () => h.who, sessionHint: async () => null }));

const WORDS = "Line one.\n\n  Line two, with spaces  \r\n";
const POST_ASK = { kind: "linkedin_post", subject: "row-7", target: "profile-post", title: "Launch note", text: WORDS, channel: "linkedin" };
const site = { origin: "http://peek.test", host: "peek.test", "content-type": "application/json" };

let db: Db;
let t: string;
let ownerId: string;
let memberId: string;
let writeKey: string;
let readKey: string;
const person = (userId: string, role: string, name: string) => ({ userId, tenantId: t, role, name, email: `${name.toLowerCase()}@acme.example`, acked: true });
const asOwner = () => (h.who = person(ownerId, "owner", "Olu"));
const key = (k: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${k}`, "content-type": "application/json", ...extra });
const file = async (b: object = POST_ASK) => (await filePost(new Request("http://peek.test/v1/owner-asks", { method: "POST", headers: key(writeKey), body: JSON.stringify(b) }))).json();
const read = async (subject = "row-7") => (await readAskRoute(new Request(`http://peek.test/v1/owner-asks?kind=linkedin_post&subject=${subject}`, { headers: key(readKey) }))).json();
const used = (textHash: string) => usedPost(new Request("http://peek.test/v1/owner-asks/used", { method: "POST", headers: key(writeKey), body: JSON.stringify({ kind: "linkedin_post", subject: "row-7", textHash }) }));
const act = (b: object) => press(new Request("http://peek.test/api/approvals", { method: "POST", headers: site, body: JSON.stringify(b) }));
const askId = async () => (await db.select({ id: ownerAsks.id }).from(ownerAsks))[0].id;
const approve = async (textHash = textHashOf(WORDS)) => act({ action: "approve", id: await askId(), textHash });

beforeEach(async () => {
  db = await memoryDb();
  h.db = db;
  h.who = null;
  const made = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  t = made.tenant.id;
  ownerId = made.owner.id;
  memberId = (await addUser(db, t, "mia@acme.example", "Mia")).id;
  writeKey = (await mintKey(db, t, "engine", ["board:read", "board:write"])).token;
  readKey = (await mintKey(db, t, "reader", ["board:read"])).token;
});

describe("a post's approval (824)", () => {
  it("hashes and keeps the words exactly as sent", async () => {
    const { ask } = await file();
    expect(ask.textHash).toBe(sha256(WORDS));
    expect(ask.textHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await db.select({ text: ownerAsks.text }).from(ownerAsks))[0].text).toBe(WORDS);
    expect(ask).toMatchObject({ found: true, byOwner: false, person: null, usedAt: null });
  });

  it("tells a missing ask from an error", async () => {
    expect(await read("nothing")).toEqual({ found: false });
    expect((await readAskRoute(new Request("http://peek.test/v1/owner-asks?kind=other&subject=x", { headers: key(readKey) }))).status).toBe(400);
    expect((await readAskRoute(new Request("http://peek.test/v1/owner-asks?kind=linkedin_post&subject=x"))).status).toBe(401);
  });

  it("is true only after a signed-in owner's press on those words", async () => {
    await file();
    asOwner();
    expect((await approve()).status).toBe(200);
    expect(await read()).toMatchObject({ byOwner: true, person: "Olu", withdrawn: false, target: "profile-post" });
    expect((await db.select({ u: ownerAnswers.byUser }).from(ownerAnswers))[0].u).toBe(ownerId);
  });

  it("refuses a member, a signed-out press, a manager and words that changed on the page", async () => {
    await file();
    h.who = person(memberId, "member", "Mia");
    expect((await approve()).status).toBe(403);
    h.who = person(memberId, "manager", "Mia");
    expect((await approve()).status).toBe(403);
    h.who = null;
    expect((await approve()).status).toBe(401);
    asOwner();
    expect((await approve(sha256("other words"))).status).toBe(409);
    expect((await read()).byOwner).toBe(false);
    expect(await db.select().from(ownerAnswers)).toEqual([]);
  });

  it("a key cannot approve through anything it can send", async () => {
    await file({ ...POST_ASK, byOwner: true, person: "Olu", approved: true, at: "2026-01-01", generation: 9 });
    expect(await read()).toMatchObject({ byOwner: false, person: null, at: null });
    const viaKey = await press(new Request("http://peek.test/api/approvals", { method: "POST", headers: { ...site, authorization: `Bearer ${writeKey}` }, body: JSON.stringify({ action: "approve", id: await askId(), textHash: textHashOf(WORDS) }) }));
    expect(viaKey.status).toBe(401);
    expect((await used(textHashOf(WORDS))).status).toBe(409);
  });

  it("identical words change nothing; other words or another place drop the approval for good", async () => {
    await file();
    asOwner();
    await approve();
    expect((await file()).ask.byOwner).toBe(true);
    const changed = await file({ ...POST_ASK, text: `${WORDS}!` });
    expect(changed.ask).toMatchObject({ textHash: sha256(`${WORDS}!`), byOwner: false, person: null });
    const back = await file();
    expect(back.ask).toMatchObject({ textHash: sha256(WORDS), byOwner: false });
    await approve();
    expect((await read()).byOwner).toBe(true);
    expect((await file({ ...POST_ASK, target: "profile-about" })).ask).toMatchObject({ target: "profile-about", byOwner: false });
  });

  it("can be withdrawn and pressed again", async () => {
    await file();
    asOwner();
    await approve();
    expect((await act({ action: "withdraw", id: await askId() })).status).toBe(200);
    expect(await read()).toMatchObject({ byOwner: false, withdrawn: true });
    expect((await used(textHashOf(WORDS))).status).toBe(409);
    await approve();
    expect(await read()).toMatchObject({ byOwner: true, withdrawn: false });
  });

  it("is used once: the first time stays, and it cannot be withdrawn or pressed again", async () => {
    await file();
    asOwner();
    await approve();
    const first = await (await used(textHashOf(WORDS))).json();
    expect(first.usedAt).toEqual(expect.any(String));
    expect(await (await used(textHashOf(WORDS))).json()).toEqual(first);
    expect((await read()).usedAt).toBe(first.usedAt);
    expect((await act({ action: "withdraw", id: await askId() })).status).toBe(409);
    expect((await approve()).status).toBe(409);
  });

  it("refuses to use another text's hash", async () => {
    await file();
    asOwner();
    await approve();
    expect((await used(sha256("other"))).status).toBe(409);
    expect((await read()).usedAt).toBeNull();
  });

  it("stops counting when the person is no longer an active owner", async () => {
    await file();
    asOwner();
    await approve();
    await db.update(users).set({ role: "manager" }).where(eq(users.id, ownerId));
    expect((await read()).byOwner).toBe(false);
    expect((await used(textHashOf(WORDS))).status).toBe(409);
    await db.update(users).set({ role: "owner", active: false }).where(eq(users.id, ownerId));
    expect((await read()).byOwner).toBe(false);
  });
});

describe("a billing bench (824)", () => {
  const bench = (b: object) => benchPost(new Request("http://peek.test/v1/billing-benches", { method: "POST", headers: key(writeKey), body: JSON.stringify(b) }));
  const list = async () => (await (await readBenches(new Request("http://peek.test/v1/billing-benches", { headers: key(readKey) }))).json()).benches as Record<string, unknown>[];
  const FIRST = { host: "api.example", itemId: "item-1", why: "billing page says paid", at: "2026-11-22T10:00:00.000Z" };

  it("is added once with its original time, and a key can never change or clear it", async () => {
    expect((await bench(FIRST)).status).toBe(200);
    await bench({ ...FIRST, why: "another reason", at: "2026-11-23T10:00:00.000Z", cleared: true, clearedAt: "2026-11-23T10:00:00.000Z", byOwner: true });
    expect(await list()).toEqual([expect.objectContaining({ ...FIRST, cleared: false, clearedAt: null, byOwner: false, person: null })]);
  });

  it("refuses a time in the future and missing fields", async () => {
    expect((await bench({ ...FIRST, at: "2099-01-01" })).status).toBe(400);
    expect((await bench({ host: "x" })).status).toBe(400);
  });

  it("is cleared only by a signed-in owner, with who and when", async () => {
    await bench(FIRST);
    const [{ id }] = await db.select({ id: billingBenches.id }).from(billingBenches);
    h.who = person(memberId, "member", "Mia");
    expect((await act({ action: "clear", id })).status).toBe(403);
    h.who = null;
    expect((await act({ action: "clear", id })).status).toBe(401);
    expect((await list())[0].cleared).toBe(false);
    asOwner();
    expect((await act({ action: "clear", id })).status).toBe(200);
    expect((await list())[0]).toMatchObject({ cleared: true, byOwner: true, person: "Olu", clearedAt: expect.any(String) });
    expect((await act({ action: "clear", id })).status).toBe(409);
  });

  it("answers 304 while nothing changed, and an empty list is not an error", async () => {
    expect(await list()).toEqual([]);
    await bench(FIRST);
    const r = await readBenches(new Request("http://peek.test/v1/billing-benches", { headers: key(readKey) }));
    const etag = r.headers.get("etag")!;
    expect((await readBenches(new Request("http://peek.test/v1/billing-benches", { headers: key(readKey, { "if-none-match": etag }) }))).status).toBe(304);
  });
});
