import { describe, expect, it, vi } from "vitest";

const PAGE = vi.hoisted(() => `<!doctype html><html><head><title>x</title></head><body><a href="gallery/">Gallery</a><script>menu()</script></body></html>`);

vi.mock("@/lib/guard", () => ({ guard: async () => ({ who: { tenantId: "t" } }) }));
vi.mock("@/lib/auth", () => ({ me: async () => ({ tenantId: "t", acked: true, role: "owner" }) }));
vi.mock("@/lib/db", () => ({ db: async () => ({}) }));
vi.mock("@/lib/samples", () => ({
  sampleDoc: async () => ({ html: PAGE, pages: [], kind: "page" }),
  withPhotos: async (_db: unknown, _t: string, _id: string, raw: string) => raw,
}));

import { GET as teamPreview } from "@/app/api/samples/[id]/preview/route";
import { GET as openSite } from "@/app/samples/[id]/preview/route";

const ctx = { params: Promise.resolve({ id: "s1" }) };
const body = async (r: Response) => Buffer.from(await r.arrayBuffer());

describe("finger mode never reaches a saved page", () => {
  it("the team preview without ?finger=1 is byte-identical to the page", async () => {
    const r = await teamPreview(new Request("http://x/api/samples/s1/preview?v=1"), ctx);
    expect((await body(r)).equals(Buffer.from(PAGE))).toBe(true);
  });

  it("Open site is byte-identical, even if someone adds ?finger=1", async () => {
    const r = await openSite(new Request("http://x/samples/s1/preview?v=1&finger=1"), ctx);
    expect((await body(r)).equals(Buffer.from(PAGE))).toBe(true);
  });

  it("the Phone preview gets it, in that response only", async () => {
    const r = await teamPreview(new Request("http://x/api/samples/s1/preview?v=1&finger=1"), ctx);
    expect((await body(r)).toString()).toContain("data-peek-finger");
    expect(PAGE).not.toContain("data-peek-finger");
  });
});
