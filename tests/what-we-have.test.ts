// The Asset page's "What we have" sections: the light markdown, the seed from the bots' mirror of
// the Notion page, and the store.
import { describe, expect, it } from "vitest";
import { checkSections, listSections, saveSections } from "@/lib/assets";
import { memoryDb } from "@/lib/db";
import { createTenant } from "@/lib/tenants";
import { linkify, parseBody } from "@/lib/what-we-have";
import { sectionsFromMirror } from "../scripts/seed-sections.mjs";

const MIRROR = `# What we have (the owner's Notion page, mirrored)

What the company actually has and charges -- written by the owner.
Last edited on Notion: 2026-10-30 16:59 UTC.

https://drive.example/folder

## Services

### Human resources (Next Office)
1. Marketing
  1. email, sms
  2. 
2. Developer
  1. JavaScript / TypeScript
    1. next

## Rates
The internal rate card.
From Peek's Asset page, where the owner edits the rates.
- Website Care Retainer: $249-$499/month

## Contact and legal names
- USA: Example LLC
`;

describe("the light markdown", () => {
  it("reads toggles, nested numbered lists and paragraphs; an empty item is dropped", () => {
    const blocks = parseBody("Intro line\n### Human resources\n1. Marketing\n  1. email\n  2. \n2. Developer\n  1. JS\n    1. next\n### Food\n- DoorDash");
    expect(blocks[0]).toEqual({ kind: "p", text: "Intro line" });
    expect(blocks[1]).toMatchObject({ kind: "toggle", title: "Human resources" });
    const list = (blocks[1] as { children: { items: { text: string; children: { items: { text: string; children: { items: { text: string }[] }[] }[] }[] }[] }[] }).children[0];
    expect(list.items.map((i) => i.text)).toEqual(["Marketing", "Developer"]);
    expect(list.items[0].children[0].items.map((i) => i.text)).toEqual(["email"]);
    expect(list.items[1].children[0].items[0].children[0].items[0].text).toBe("next");
    expect(blocks[2]).toMatchObject({ kind: "toggle", title: "Food", children: [{ kind: "list", ordered: false, items: [{ text: "DoorDash" }] }] });
  });

  it("links URLs, leaving a trailing full stop outside", () => {
    expect(linkify("See https://acme.example/a. Thanks")).toEqual([{ text: "See " }, { text: "https://acme.example/a", href: "https://acme.example/a" }, { text: ". Thanks" }]);
  });
});

describe("the seed from the mirror", () => {
  it("one section per ## heading; the link before them untitled; Rates keeps its paragraph, not its rate lines", () => {
    const s = sectionsFromMirror(MIRROR);
    expect(s.map((x) => [x.title, x.kind])).toEqual([
      ["", "text"],
      ["Services", "text"],
      ["Rates", "rates"],
      ["Contact and legal names", "text"],
    ]);
    expect(s[0].body).toBe("https://drive.example/folder");
    expect(s[1].body.startsWith("### Human resources (Next Office)\n1. Marketing\n  1. email, sms")).toBe(true);
    expect(s[2].body).toBe("The internal rate card.");
  });
});

describe("the sections store", () => {
  it("checks, saves in order, edits one and reads back; one rate-card section at most", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "acme", "acme", { email: "o@acme.example", name: "Olu" });
    const c = checkSections([{ title: "Services", body: "- Web" }, { title: "", body: "" }, { title: "Rates", kind: "rates", body: "" }]);
    expect(c.ok && c.items.map((x) => x.title)).toEqual(["Services", "Rates"]);
    expect(checkSections([{ title: "A", kind: "rates" }, { title: "B", kind: "rates" }]).ok).toBe(false);
    expect(checkSections([{ title: "A", kind: "table" }]).ok).toBe(false);
    if (!c.ok) return;
    await saveSections(db, tenant.id, c.items, "Olu");
    let rows = await listSections(db, tenant.id);
    expect(rows.map((r) => [r.position, r.title, r.kind])).toEqual([
      [1, "Services", "text"],
      [2, "Rates", "rates"],
    ]);
    const r = await saveSections(db, tenant.id, [{ ...rows[1] }, { ...rows[0], body: "- Web\n  - Next.js" }], "Ann");
    expect(r.ok && [r.changed, r.added, r.removed]).toEqual([1, 0, 0]);
    rows = await listSections(db, tenant.id);
    expect(rows.map((x) => x.title)).toEqual(["Rates", "Services"]);
    expect([rows[1].body, rows[1].updatedBy]).toEqual(["- Web\n  - Next.js", "Ann"]);
  });
});
