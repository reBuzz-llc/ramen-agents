// Managers see it too. The Reference row and its route are for the owner and managers
// (samples.reference); members get neither, and deleting a sample stays the owner's.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { can } from "@/lib/roles";
import type { SampleCard } from "@/lib/samples";

const h = vi.hoisted(() => ({ role: "owner", set: vi.fn(async () => ({ sampleId: "s", version: 3 })), family: vi.fn(async () => ({ sampleId: "s" })), clear: vi.fn(async () => undefined) }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/lib/auth", () => ({ me: async () => ({ tenantId: "t", userId: "u", name: "A Person", email: "a@test.example", acked: true, role: h.role }) }));
vi.mock("@/lib/db", () => ({ db: async () => ({}) }));
vi.mock("@/lib/sample-references", async (real) => ({ ...(await real<typeof import("@/lib/sample-references")>()), setReference: h.set, setReferenceFamily: h.family, clearReference: h.clear }));

const card = (over: Partial<SampleCard> = {}) =>
  ({
    id: "11111111-2222-4333-8444-555555555558", leadId: "l", business: "A Test Cafe", area: "Queens, NY", trade: "Cafe", template: "eat", status: "approved", version: 3,
    draftedAt: "2026-11-21T10:55:00Z", draftedBy: "Site Builder", reviewedBy: "Owner", url: "", hold: false, frozen: false, note: "", leadHref: "/leads/l", kind: "page", changes: "",
    designReason: "", sources: [], open: "/samples/x/preview", pages: [], guestPhotos: [], approvedVersion: 3, requests: [],
    ...over,
  }) as SampleCard;

async function row(role: "owner" | "manager" | "member", over: Partial<SampleCard> = {}) {
  const { default: SampleDetail } = await import("@/app/samples/sample-cards");
  return renderToStaticMarkup(createElement(SampleDetail, { c: card(over), isOwner: role === "owner", canMark: can(role, "samples.reference"), backHref: "/samples", publishPolledAt: "" }));
}

async function post(role: string, action = "set") {
  h.role = role;
  const { POST } = await import("@/app/api/samples/[id]/reference/route");
  const req = new Request("http://peek.test/api/samples/s/reference", { method: "POST", headers: { origin: "http://peek.test", "x-forwarded-host": "peek.test", "content-type": "application/json" }, body: JSON.stringify({ action, family: "eat" }) });
  return POST(req, { params: Promise.resolve({ id: "s" }) });
}

describe("who uses the Reference row", () => {
  beforeEach(() => vi.clearAllMocks());

  it("the owner and a manager get the switch; a member does not", async () => {
    expect(await row("owner")).toContain('role="switch"');
    expect(await row("manager")).toContain('role="switch"');
    expect(await row("member")).not.toContain('role="switch"');
  });

  it("the route lets the owner and a manager set, change and clear; a member is refused and nothing is written", async () => {
    for (const role of ["owner", "manager"]) for (const action of ["set", "family", "clear"]) expect((await post(role, action)).status).toBe(200);
    expect(h.set).toHaveBeenCalledTimes(2);
    vi.clearAllMocks();
    for (const action of ["set", "family", "clear"]) expect((await post("member", action)).status).toBe(403);
    expect(h.set).not.toHaveBeenCalled();
    expect(h.family).not.toHaveBeenCalled();
    expect(h.clear).not.toHaveBeenCalled();
  });

  it("the page gives the row by samples.reference, and deleting a sample stays the owner's", async () => {
    expect(readFileSync(`${process.cwd()}/app/samples/page.tsx`, "utf8")).toContain('canMark={can(who.role, "samples.reference")}');
    expect(readFileSync(`${process.cwd()}/app/api/samples/[id]/route.ts`, "utf8")).toMatch(/g\.who\.role !== "owner"[^\n]*only the owner deletes a sample/);
    expect(await row("owner", { status: "taken_down" })).toContain("data-delete-sample");
    expect(await row("manager", { status: "taken_down" })).not.toContain("data-delete-sample");
  });
});
