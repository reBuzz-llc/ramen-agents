// The database is a long round trip away (~285 ms from the team to Neon us-east-2), so each query a page runs in a row is
// time the person waits. These counts are budgets: a change that adds a query to a hot path fails here first.
import { beforeAll, describe, expect, it } from "vitest";
import { claimsOf } from "@/lib/claims";
import { memoryDb } from "@/lib/db";
import { authSessions, boardRows } from "@/lib/db/schema";
import { sha256 } from "@/lib/crypto";
import { boardPages } from "@/lib/notion";
import { acknowledge } from "@/lib/notice";
import { principalByEmail, sessionUser } from "@/lib/principal";
import { weekRows } from "@/lib/scoreboard";
import { createTenant } from "@/lib/tenants";

beforeAll(() => {
  process.env.TEAMS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

async function setup() {
  const seen: string[] = [];
  const db = await memoryDb(undefined, (q) => seen.push(q));
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  await acknowledge(db, tenant.id, owner.id);
  await db.insert(authSessions).values({ idHash: sha256("tok"), userId: owner.id, expiresAt: new Date(Date.now() + 86400e3) });
  await db.insert(boardRows).values({ tenantId: tenant.id, pageId: "p1", data: { id: "p1", properties: {} } });
  seen.length = 0;
  return { db, tenant, owner, seen, count: async (f: () => Promise<unknown>) => ((seen.length = 0), await f(), seen.length) };
}

describe("round trips", () => {
  it("who is signed in, their company, settings and notice state: one query", async () => {
    const { db, count } = await setup();
    expect(await count(() => principalByEmail(db, "O@acme.example"))).toBe(1);
    expect(await count(() => sessionUser(db, "tok"))).toBe(1);
    const me = await principalByEmail(db, "o@acme.example");
    expect(me).toMatchObject({ tenantName: "Acme", role: "owner", acked: true, settings: {} });
  });

  it("the queue's own reads (fresh board cache, claims): one query each, run side by side", async () => {
    const { db, tenant, count } = await setup();
    expect(await count(() => boardPages(db, tenant.id))).toBe(1);
    expect(await count(() => claimsOf(db, tenant.id))).toBe(1);
  });

  it("the week's rows: three queries, sent together", async () => {
    const { db, tenant, count } = await setup();
    expect(await count(() => weekRows(db, tenant.id, new Date(0)))).toBe(3);
  });
});
