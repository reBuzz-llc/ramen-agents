// The portal's own Google sign-in: Neon Auth is not needed. Google is stood in for by a fetch stub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type Db } from "@/lib/db";
import { authSessions, users } from "@/lib/db/schema";
import { challengeOf } from "@/lib/google-signin";
import { createTenant } from "@/lib/tenants";

let current: Db;
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), db: async () => current }));

const ORIGIN = "https://peek.example";
let who: { email: string; email_verified: boolean; name: string } = { email: "sam@acme.example", email_verified: true, name: "Sam" };
const seen: { url: string; body: string }[] = [];

beforeEach(async () => {
  process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
  current = await memoryDb();
  const { tenant } = await createTenant(current, "Acme", "acme", { email: "owner@acme.example", name: "Olu" });
  await current.insert(users).values({ tenantId: tenant.id, email: "sam@acme.example", name: "Sam", role: "member" });
  seen.length = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), body: String(init?.body ?? "") });
    if (String(url).includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "at-123" }), { status: 200 });
    if (String(url).includes("userinfo")) return new Response(JSON.stringify(who), { status: 200 });
    return new Response("{}", { status: 404 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  who = { email: "sam@acme.example", email_verified: true, name: "Sam" };
});

async function start(next = "") {
  const { GET } = await import("@/app/api/google-signin/start/route");
  const res = await GET(new Request(`${ORIGIN}/api/google-signin/start${next ? `?next=${encodeURIComponent(next)}` : ""}`));
  const set = res.headers.getSetCookie();
  const cookie = (name: string) => set.find((c) => c.startsWith(`${name}=`))?.split(";")[0].split("=")[1] ?? "";
  return { res, state: cookie("pp_g_state"), verifier: cookie("pp_g_verifier"), next: cookie("pp_g_next") };
}
async function callback(state: string, cookieState: string, verifier: string, next = "") {
  const { GET } = await import("@/app/api/google-signin/callback/route");
  const cookie = [`pp_g_state=${cookieState}`, `pp_g_verifier=${verifier}`, next ? `pp_g_next=${next}` : ""].filter(Boolean).join("; ");
  return GET(new Request(`${ORIGIN}/api/google-signin/callback?code=the-code&state=${state}`, { headers: { cookie } }));
}

describe("Google sign-in without Neon Auth", () => {
  it("start: to Google's consent page with a PKCE challenge, the state and verifier kept in cookies", async () => {
    const { res, state, verifier } = await start("/todo");
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(to.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/google-signin/callback`);
    expect(to.searchParams.get("state")).toBe(state);
    expect(to.searchParams.get("code_challenge")).toBe(challengeOf(verifier));
    expect(to.searchParams.get("scope")).toBe("openid email profile");
  });

  it("signs a person of the company in with the portal's own session and goes where they were headed", async () => {
    const s = await start("/todo");
    const res = await callback(s.state, s.state, s.verifier, encodeURIComponent("/todo"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/todo`);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("pp_session=") && /HttpOnly/i.test(c) && /Secure/i.test(c))).toBe(true);
    expect((await current.select().from(authSessions)).length).toBe(1);
    const sam = (await current.select().from(users)).find((u) => u.email === "sam@acme.example");
    expect(sam?.firstSignedInAt).toBeTruthy();
    expect(seen.find((x) => x.url.includes("/token"))?.body).toContain(`code_verifier=${s.verifier}`);
  });

  it("turns an unknown email back with the reason and creates nothing", async () => {
    who = { email: "stranger@else.example", email_verified: true, name: "S" };
    const before = (await current.select().from(users)).length;
    const s = await start();
    const res = await callback(s.state, s.state, s.verifier);
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/sign-in");
    expect(to.searchParams.get("error")).toMatch(/stranger@else\.example: no account for that email/);
    expect((await current.select().from(users)).length).toBe(before);
    expect((await current.select().from(authSessions)).length).toBe(0);
  });

  it("refuses a state that is not this browser's, and an unverified Google email", async () => {
    const s = await start();
    const forged = await callback("someone-elses-state", s.state, s.verifier);
    expect(new URL(forged.headers.get("location")!).searchParams.get("error")).toMatch(/expired/);
    who = { email: "sam@acme.example", email_verified: false, name: "Sam" };
    const unverified = await callback(s.state, s.state, s.verifier);
    expect(new URL(unverified.headers.get("location")!).searchParams.get("error")).toMatch(/not verified/);
    expect((await current.select().from(authSessions)).length).toBe(0);
  });
});
