import { describe, expect, it } from "vitest";
import { sha256 } from "@/lib/crypto";
import { memoryDb } from "@/lib/db";
import { getLead, writeLead } from "@/lib/leads";
import { cleanRich } from "@/lib/rich-clean";
import { hasPictures, isDocsPaste, MAX_RICH, richWithEnding, textToHtml } from "@/lib/rich-text";
import { readRich, richFor, richRows, saveRich } from "@/lib/rich-text-db";
import { createTenant } from "@/lib/tenants";

const DOC = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234-abcd"><h1 dir="ltr" style="line-height:1.38;margin-top:20pt;margin-bottom:6pt;"><span style="font-size:20pt;font-family:Arial,sans-serif;color:#ff6600;font-weight:400;white-space:pre-wrap;">Title</span></h1><p dir="ltr" style="line-height:1.38;text-align:center;margin-top:0pt;"><span style="font-size:11pt;font-weight:700;font-style:italic;text-decoration:underline;background-color:#ffff00;">Bold</span></p><ul style="margin-top:0;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;"><p role="presentation"><a href="https://example.com/a" style="color:#1155cc;"><span>link</span></a></p></li></ul><table style="border:none;border-collapse:collapse;"><colgroup><col width="100"></colgroup><tbody><tr><td colspan="2" style="border-left:solid #000000 1pt;padding:5pt 5pt 5pt 5pt;">cell</td></tr></tbody></table><img src="https://lh7-rt.googleusercontent.com/x.png"></b>`;

describe("what a paste from a Google Doc keeps", () => {
  const clean = cleanRich(DOC);

  it("recognises only a Google Doc", () => {
    expect(isDocsPaste(DOC)).toBe(true);
    expect(isDocsPaste("<p>from a web page</p>")).toBe(false);
    expect(hasPictures(DOC)).toBe(true);
  });

  it("keeps headings, fonts, sizes, colours, emphasis, alignment, lists, links and tables", () => {
    for (const piece of ["<h1", "font-size:20pt", "font-family:Arial,sans-serif", "color:#ff6600", "font-weight:700", "font-style:italic", "text-decoration:underline", "background-color:#ffff00", "text-align:center", "<ul", "list-style-type:disc", 'href="https://example.com/a"', "<table", 'colspan="2"', "border-left:solid #000000 1pt", "padding:5pt 5pt 5pt 5pt", "white-space:pre-wrap"]) expect(clean).toContain(piece);
  });

  it("drops the picture and the document's ids", () => {
    expect(clean).not.toContain("<img");
    expect(clean).not.toContain("docs-internal-guid");
  });

  it("opens a link in a new tab, without access to this page", () => expect(clean).toContain('rel="noopener noreferrer"'));

  it.each([
    `<script>alert(1)</script>x`,
    `<img src=x onerror=alert(1)>x`,
    `<p onclick="alert(1)">x</p>`,
    `<a href="javascript:alert(1)">x</a>`,
    `<a href="  JaVaScRiPt:alert(1)">x</a>`,
    `<a href="data:text/html,<script>alert(1)</script>">x</a>`,
    `<a href="//evil.example/">x</a>`,
    `<iframe src="https://evil.example"></iframe>x`,
    `<svg onload=alert(1)></svg>x`,
    `<style>body{display:none}</style>x`,
    `<form action="https://evil.example"><input name=a></form>x`,
    `<p style="background-image:url(https://evil.example/t.png)">x</p>`,
    `<p style="background-color:url(https://evil.example/t.png)">x</p>`,
    `<p style="position:fixed;inset:0;z-index:9999">x</p>`,
    `<p style="font-family:x;}body{display:none">x</p>`,
    `<p style="width:expression(alert(1))">x</p>`,
    `<math><mtext><style><img src=x onerror=alert(1)></style></mtext></math>x`,
  ])("removes anything active: %s", (bad) => {
    const out = cleanRich(bad).toLowerCase();
    for (const word of ["<script", "onerror", "onclick", "onload", "javascript:", "data:", "<iframe", "<svg", "<style", "<form", "<input", "url(", "position", "z-index", "expression", "evil.example", "<img"]) expect(out).not.toContain(word);
  });
});

describe("the copy with its closing line", () => {
  it("adds the sample link after the document", () => {
    expect(richWithEnding("<p>Hi</p>", "Hi\n", "Hi\n\nYour sample site: https://a.example/?x=1&y=2")).toBe("<p>Hi</p><br>Your sample site: https://a.example/?x=1&amp;y=2");
  });
  it("is the document itself when nothing is added", () => expect(richWithEnding("<p>Hi</p>", "Hi", "Hi")).toBe("<p>Hi</p>"));
  it("gives up rather than copy a different text", () => expect(richWithEnding("<p>Hi</p>", "Hi", "Hello")).toBeNull());
  it("escapes plain text", () => expect(textToHtml("a<b>\nc")).toBe("a&lt;b&gt;<br>c"));
});

describe("stored beside the cell", () => {
  const setup = async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const made = (await writeLead(db, tenant.id, {}, { business: "Beta" }, { kind: "bot", name: "Writer", via: "engine" }, { create: true })) as { ok: true; lead: { id: string } };
    const person = { kind: "person" as const, name: "Olu", userId: owner.id };
    const write = async (text: string) => ((await writeLead(db, tenant.id, { id: made.lead.id }, { notes: text }, person)) as { ok: true; lead: Record<string, unknown> }).lead;
    const shown = async () => richFor(await richRows(db, tenant.id, made.lead.id), (await getLead(db, tenant.id, { id: made.lead.id })) as Record<string, unknown>);
    return { db, tenant, owner, id: made.lead.id, write, shown };
  };

  it("shows while the cell holds that text, and stops when the cell changes", async () => {
    const { db, tenant, owner, id, write, shown } = await setup();
    const lead = await write("Hello");
    expect(await saveRich(db, tenant.id, id, owner.id, { notes: "<p><b>Hello</b></p>" }, { notes: "Hello" }, lead)).toEqual({ notes: "<p><b>Hello</b></p>" });
    expect(await shown()).toEqual({ notes: "<p><b>Hello</b></p>" });
    await write("Changed by someone");
    expect(await shown()).toEqual({});
  });

  it("keeps no copy for a refused field, for other text, or when asked to drop it", async () => {
    const { db, tenant, owner, id, write, shown } = await setup();
    const lead = await write("Hello");
    expect(await saveRich(db, tenant.id, id, owner.id, { notes: "<p>Hello</p>" }, { notes: "Hello" }, lead, ["notes"])).toEqual({});
    expect(await shown()).toEqual({});
    expect(await saveRich(db, tenant.id, id, owner.id, { notes: "<p>Other</p>" }, { notes: "Other" }, lead)).toEqual({ notes: null });
    expect(await shown()).toEqual({});
    await saveRich(db, tenant.id, id, owner.id, { notes: "<p>Hello</p>" }, { notes: "Hello" }, lead);
    await saveRich(db, tenant.id, id, owner.id, { notes: null }, { notes: "Hello" }, lead);
    expect(await shown()).toEqual({});
  });

  it("cleans what it reads, even if a stored row is not clean", () => {
    const row = { field: "notes", html: `<p onclick="x()">Hi</p><script>x()</script>`, plainHash: sha256("Hi") };
    expect(richFor([row], { notes: "Hi" })).toEqual({ notes: "<p>Hi</p>" });
    expect(richFor([{ ...row, plainHash: "nope" }], { notes: "Hi" })).toEqual({});
  });

  it("takes only the long cells, and refuses a document that is too long", () => {
    expect(readRich({ notes: `<p onclick="x()">a</p>`, business: "<b>x</b>", pain_point: null, draft_email: 3 })).toEqual({ ok: true, wanted: { notes: "<p>a</p>", pain_point: null } });
    expect(readRich({ notes: "x".repeat(MAX_RICH + 1) }).ok).toBe(false);
    expect(readRich(undefined)).toEqual({ ok: true, wanted: {} });
  });
});
