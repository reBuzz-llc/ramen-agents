// Local mode's sign-in codes: issued by the owner, shown once, hashed, 14 days, one live per
// person, five wrong tries lock an email for 15 minutes; the script's hash is the app's.
import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { checkCode, codeHash, issueCode, newCode, normCode, resetTries } from "@/lib/local-codes";
import { createTenant } from "@/lib/tenants";
import { codeHash as scriptHash } from "../scripts/local-code.mjs";

async function setup() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  return { db, tenantId: tenant.id, ownerId: owner.id };
}

describe("local sign-in codes", () => {
  beforeEach(() => resetTries());

  it("look like ABCD-EFGH-JK without look-alikes, and the script hashes them as the app does", () => {
    const c = newCode();
    expect(c).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{2}$/);
    expect(normCode(" abcd efgh-jk ")).toBe("ABCDEFGHJK");
    expect(scriptHash("abcd-efgh-jk")).toBe(codeHash("ABCDEFGHJK"));
  });

  it("sign a person in with their email and live code; a new code revokes the old; another email or an expired code does not", async () => {
    const { db, tenantId, ownerId } = await setup();
    const first = await issueCode(db, tenantId, ownerId, "test");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(await checkCode(db, "O@acme.example ", first.code.toLowerCase())).toEqual({ ok: true, userId: ownerId });
    expect((await checkCode(db, "someone@else.example", first.code)).ok).toBe(false);
    const second = await issueCode(db, tenantId, ownerId, "test");
    expect((await checkCode(db, "o@acme.example", first.code)).ok).toBe(false); // revoked
    if (!second.ok) return;
    expect((await checkCode(db, "o@acme.example", second.code)).ok).toBe(true);
    const later = Date.now() + 15 * 86400e3;
    expect((await checkCode(db, "o@acme.example", second.code, later)).ok).toBe(false); // expired
  });

  it("lock an email after five wrong tries for 15 minutes, even with the right code", async () => {
    const { db, tenantId, ownerId } = await setup();
    const r = await issueCode(db, tenantId, ownerId, "test");
    if (!r.ok) return;
    const now = Date.now();
    for (let i = 0; i < 5; i++) expect((await checkCode(db, "o@acme.example", "WRON-GCOD-EX", now)).ok).toBe(false);
    const locked = await checkCode(db, "o@acme.example", r.code, now);
    expect(locked.ok).toBe(false);
    expect(!locked.ok && locked.error).toMatch(/Too many wrong codes/);
    expect((await checkCode(db, "o@acme.example", r.code, now + 16 * 60_000)).ok).toBe(true);
  });

  it("are never issued for someone of another company", async () => {
    const { db, ownerId } = await setup();
    const other = (await createTenant(db, "Other", "other", { email: "x@other.example", name: "X" })).tenant.id;
    expect((await issueCode(db, other, ownerId, "test")).ok).toBe(false);
  });
});

describe("outage mode", () => {
  it("turns code sign-in on with PEEK_OUTAGE_SIGNIN=1 as with PEEK_LOCAL_MODE=1, and off with neither", async () => {
    const { localMode } = await import("@/lib/local-codes");
    const keep = { l: process.env.PEEK_LOCAL_MODE, o: process.env.PEEK_OUTAGE_SIGNIN };
    delete process.env.PEEK_LOCAL_MODE;
    delete process.env.PEEK_OUTAGE_SIGNIN;
    expect(localMode()).toBe(false);
    process.env.PEEK_OUTAGE_SIGNIN = "1";
    expect(localMode()).toBe(true);
    delete process.env.PEEK_OUTAGE_SIGNIN;
    process.env.PEEK_LOCAL_MODE = "1";
    expect(localMode()).toBe(true);
    if (keep.l === undefined) delete process.env.PEEK_LOCAL_MODE; else process.env.PEEK_LOCAL_MODE = keep.l;
    if (keep.o === undefined) delete process.env.PEEK_OUTAGE_SIGNIN; else process.env.PEEK_OUTAGE_SIGNIN = keep.o;
  });
});
