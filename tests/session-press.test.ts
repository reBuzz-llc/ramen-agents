// A signed-in press with consequences keeps a hash of its session and that session's sign-in time, so it can
// be tied to the same session's other presses. No cookie or token is stored, no page or /v1 route returns it, and a failed record never
// fails the press. Invented people and businesses.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as press } from "@/app/api/approvals/route";
import { POST as review } from "@/app/api/samples/[id]/route";
import { POST as fileRequest } from "@/app/api/samples/[id]/requests/route";
import { sha256 } from "@/lib/crypto";
import { memoryDb, type Db } from "@/lib/db";
import { authSessions, ownerAsks, sessionPresses } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { fileAsk, textHashOf } from "@/lib/owner-asks";
import { sampleFooter, saveDraft } from "@/lib/samples";
import { createSession } from "@/lib/session";
import { pressHash, pressLine } from "@/lib/session-press";
import { addUser, createTenant } from "@/lib/tenants";

const h = vi.hoisted(() => ({ db: null as unknown, who: null as unknown, token: "" as string, throwCookies: false }));
vi.mock("@/lib/db", async (real) => ({ ...(await real<typeof import("@/lib/db")>()), db: async () => h.db }));
vi.mock("@/lib/auth", () => ({ me: async () => h.who, sessionHint: async () => null }));
vi.mock("next/headers", () => ({ cookies: async () => { if (h.throwCookies) throw new Error("no request"); return { get: (n: string) => (n === "pp_session" && h.token ? { value: h.token } : undefined) }; } }));

const WORDS = "An invented post.";
const site = { origin: "http://peek.test", host: "peek.test", "content-type": "application/json" };
const page = `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1><p>v1</p>${sampleFooter("Gamma Grill", "")}</body></html>`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
let db: Db;
let t: string;
let ownerId: string;
let memberId: string;
let sid: string;
const person = (userId: string, role: string, name: string) => ({ userId, tenantId: t, role, name, email: `${name.toLowerCase()}@acme.example`, acked: true, settings: {} });
const act = (b: object) => press(new Request("http://peek.test/api/approvals", { method: "POST", headers: site, body: JSON.stringify(b) }));
const askId = async () => (await db.select({ id: ownerAsks.id }).from(ownerAsks))[0].id;
const presses = () => db.select().from(sessionPresses);

beforeEach(async () => {
  db = await memoryDb();
  h.db = db;
  h.throwCookies = false;
  const m = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  t = m.tenant.id;
  ownerId = m.owner.id;
  memberId = (await addUser(db, t, "mia@acme.example", "Mia")).id;
  const who: Actor = { kind: "person", name: "Olu", userId: ownerId };
  const r = await writeLead(db, t, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", package: "Starter Website" }, who, { create: true });
  if (!r.ok) throw new Error(r.message);
  sid = (await saveDraft(db, t, String(r.lead.id), "eat", undefined, "Site Builder", async () => "", { html: page })).id;
  await fileAsk(db, t, { kind: "linkedin_post", subject: "row-7", target: "profile-post", title: "Launch", text: WORDS, channel: "linkedin" }, "engine");
  h.token = (await createSession(db, ownerId)).token;
  h.who = person(ownerId, "owner", "Olu");
});

describe("a press keeps its session (833)", () => {
  it("records an Approve and a Withdraw with the session's hash and sign-in time, and no token", async () => {
    const id = await askId();
    await act({ action: "approve", id, textHash: textHashOf(WORDS) });
    await act({ action: "withdraw", id });
    const rows = await presses();
    const [s] = await db.select().from(authSessions);
    expect(rows.map((r) => r.action).sort()).toEqual(["owner.approve", "owner.withdraw"]);
    for (const r of rows) {
      expect(r).toMatchObject({ rowKind: "owner_ask", rowId: id, userId: ownerId, sessionHash: pressHash(s.idHash), sessionAt: s.createdAt });
      expect(r.sessionHash).not.toBe(s.idHash);
      expect(JSON.stringify(r)).not.toContain(h.token);
    }
  });

  it("ties two presses of one session together and tells another session apart", async () => {
    const id = await askId();
    await act({ action: "approve", id, textHash: textHashOf(WORDS) });
    await act({ action: "withdraw", id });
    h.token = (await createSession(db, ownerId)).token;
    await act({ action: "approve", id, textHash: textHashOf(WORDS) });
    expect(new Set((await presses()).map((r) => r.sessionHash)).size).toBe(2);
    expect(sha256(h.token)).not.toBe("");
  });

  it("records a sample's Approve and a person's requests", async () => {
    await review(new Request(`http://peek.test/api/samples/${sid}`, { method: "POST", headers: site, body: JSON.stringify({ action: "approve", version: 1 }) }), ctx(sid));
    await review(new Request(`http://peek.test/api/samples/${sid}`, { method: "POST", headers: site, body: JSON.stringify({ action: "changes", note: "Bigger logo" }) }), ctx(sid));
    const form = new FormData();
    form.set("text", "From the form");
    await fileRequest(new Request(`http://peek.test/api/samples/${sid}/requests`, { method: "POST", headers: { origin: site.origin, host: site.host }, body: form }), ctx(sid));
    expect((await presses()).map((r) => r.action).sort()).toEqual(["sample.approve", "sample.request", "sample.request"]);
  });

  it("records nothing for a refused press", async () => {
    h.who = person(memberId, "member", "Mia");
    expect((await act({ action: "approve", id: await askId(), textHash: textHashOf(WORDS) })).status).toBe(403);
    expect(await presses()).toEqual([]);
  });

  it("a press still goes through when the record cannot be made", async () => {
    h.throwCookies = true;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await act({ action: "approve", id: await askId(), textHash: textHashOf(WORDS) })).status).toBe(200);
    expect(await presses()).toEqual([]);
    quiet.mockRestore();
  });

  it("its log line carries time, action, row and hash, and no person", () => {
    const line = pressLine(new Date("2026-11-23T06:32:44.468Z"), "owner.approve", "row-id", "abc");
    expect(line).toBe('peek press {"at":"2026-11-23T06:32:44.468Z","action":"owner.approve","row":"row-id","session":"abc"}');
  });

  it("no route or page reads it back", () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const readers = walk(path.join(process.cwd(), "app")).filter((f) => /\.tsx?$/.test(f) && /sessionPresses|session_presses/.test(readFileSync(f, "utf8")));
    expect(readers).toEqual([]);
  });
});
