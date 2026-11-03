import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { attachmentCounts, attachmentsLine, changeFile, deleteFile, filesOfLead, finishUpload, getFile, historyOfFile, listFiles, MAX_BYTES, setAttached, startUpload } from "@/lib/files";
import { writeLead } from "@/lib/leads";
import { readLocal, storage, writeLocal } from "@/lib/storage";
import { addUser, createTenant } from "@/lib/tenants";

async function company() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const ann = await addUser(db, tenant.id, "ann@acme.example", "Ann");
  const bo = await addUser(db, tenant.id, "bo@acme.example", "Bo");
  const mo = await addUser(db, tenant.id, "mo@acme.example", "Mo", "manager");
  const as = (u: { id: string; name: string; role: "owner" | "manager" | "member" }) => ({ userId: u.id, name: u.name, role: u.role });
  return { db, tenantId: tenant.id, OLU: as(owner), ANN: as(ann), BO: as(bo), MO: as(mo) };
}

async function uploaded(db: Awaited<ReturnType<typeof company>>["db"], tenantId: string, who: { userId: string; name: string; role: "owner" | "manager" | "member" }, name = "Website Care Retainer.pdf") {
  const s = await startUpload(db, tenantId, who, { name, size: 120_000, type: "application/pdf", tag: "SMB Website Care Retainer" });
  if (!s.ok) throw new Error(s.error);
  const f = await finishUpload(db, tenantId, s.file.id, who, 118_204);
  if (!f.ok) throw new Error(f.error);
  return f.file;
}

describe("uploading", () => {
  it("records the file's metadata once the bytes arrived; nothing is listed while pending", async () => {
    const { db, tenantId, ANN } = await company();
    const s = await startUpload(db, tenantId, ANN, { name: "  pricing/sheet  ", size: 2048, type: "application/pdf", tag: "POS & Ordering" });
    expect(s.ok && s.file).toMatchObject({ name: "pricing sheet.pdf", status: "pending", tag: "POS & Ordering", contentType: "application/pdf" });
    if (!s.ok) return;
    expect(s.file.key.startsWith(`${tenantId}/`)).toBe(true);
    expect(await listFiles(db, tenantId)).toEqual([]);
    const done = await finishUpload(db, tenantId, s.file.id, ANN, 2000);
    expect(done.ok && done.file).toMatchObject({ status: "ready", size: 2000 });
    expect((await listFiles(db, tenantId)).map((f) => [f.name, f.uploader, f.attachedTo])).toEqual([["pricing sheet.pdf", "Ann", 0]]);
    expect((await historyOfFile(db, tenantId, s.file.id)).map((h) => [h.action, h.actorName])).toEqual([["upload", "Ann"]]);
  });

  it("refuses other types, empty files, over 25 MB, and an upload that never arrived", async () => {
    const { db, tenantId, ANN, BO } = await company();
    expect(await startUpload(db, tenantId, ANN, { name: "x.exe", size: 10, type: "application/x-msdownload" })).toEqual({ ok: false, error: "PDFs, PNG and JPG only." });
    expect((await startUpload(db, tenantId, ANN, { name: "big.pdf", size: MAX_BYTES + 1, type: "application/pdf" })).ok).toBe(false);
    expect((await startUpload(db, tenantId, ANN, { name: "empty.pdf", size: 0, type: "application/pdf" })).ok).toBe(false);
    const logo = await startUpload(db, tenantId, ANN, { name: "logo", size: 900, type: "image/png" });
    expect(logo.ok && logo.file.name).toBe("logo.png");
    if (!logo.ok) return;
    expect((await finishUpload(db, tenantId, logo.file.id, BO, 900)).ok).toBe(false); // not Bo's upload
    expect(await finishUpload(db, tenantId, logo.file.id, ANN, null)).toEqual({ ok: false, error: "The upload did not arrive; try again." });
    expect(await getFile(db, tenantId, logo.file.id)).toBeNull(); // the pending row went
  });
});

describe("who may change what", () => {
  it("the uploader, a manager and the owner rename, retag and delete; another member cannot", async () => {
    const { db, tenantId, OLU, ANN, BO, MO } = await company();
    const f = await uploaded(db, tenantId, ANN);
    expect(await changeFile(db, tenantId, f.id, BO, { name: "mine now.pdf" })).toMatchObject({ ok: false });
    expect(await deleteFile(db, tenantId, f.id, BO)).toMatchObject({ ok: false });
    expect((await changeFile(db, tenantId, f.id, ANN, { name: "Care retainer 2026.pdf" })).ok).toBe(true);
    expect((await changeFile(db, tenantId, f.id, MO, { tag: "Website Care" })).ok).toBe(true);
    expect((await changeFile(db, tenantId, f.id, OLU, { name: "" })).ok).toBe(false); // a file needs a name
    const del = await deleteFile(db, tenantId, f.id, OLU);
    expect(del).toEqual({ ok: true, key: f.key });
    expect(await listFiles(db, tenantId)).toEqual([]);
    expect((await historyOfFile(db, tenantId, f.id)).map((h) => [h.action, h.actorName])).toEqual([
      ["delete", "Olu"],
      ["tag", "Mo"],
      ["rename", "Ann"],
      ["upload", "Ann"],
    ]);
  });

  it("keeps companies apart", async () => {
    const { db, tenantId, ANN } = await company();
    const f = await uploaded(db, tenantId, ANN);
    const other = await createTenant(db, "Bravo", "bravo", { email: "o@bravo.example", name: "B" });
    const B = { userId: other.owner.id, name: "B", role: "owner" as const };
    expect(await listFiles(db, other.tenant.id)).toEqual([]);
    expect(await getFile(db, other.tenant.id, f.id)).toBeNull();
    expect((await changeFile(db, other.tenant.id, f.id, B, { name: "x.pdf" })).ok).toBe(false);
    expect((await deleteFile(db, other.tenant.id, f.id, B)).ok).toBe(false);
  });
});

describe("attaching to a lead", () => {
  it("attach and detach are recorded with the person; the copied draft names the files; a deleted file comes off", async () => {
    const { db, tenantId, ANN, BO } = await company();
    const f = await uploaded(db, tenantId, ANN);
    const g = await uploaded(db, tenantId, ANN, "Menu sample.pdf");
    const lead = await writeLead(db, tenantId, {}, { business: "Acme Bakery", website: "https://acmebakery.example" }, { kind: "bot", name: "backfill", via: "backfill" }, { create: true, import: true });
    if (!lead.ok) throw new Error(lead.message);
    const id = lead.lead.id;
    expect((await setAttached(db, tenantId, id, f.id, BO, true)).ok).toBe(true);
    expect((await setAttached(db, tenantId, id, f.id, BO, true)).ok).toBe(true); // twice: once
    await setAttached(db, tenantId, id, g.id, ANN, true);
    expect((await filesOfLead(db, tenantId, id)).map((x) => x.name)).toEqual(["Website Care Retainer.pdf", "Menu sample.pdf"]);
    expect((await attachmentCounts(db, tenantId, [id])).get(id)).toBe(2);
    expect(attachmentsLine((await filesOfLead(db, tenantId, id)).map((x) => x.name))).toBe("Attachments: Website Care Retainer.pdf, Menu sample.pdf");
    await setAttached(db, tenantId, id, f.id, ANN, false);
    expect((await historyOfFile(db, tenantId, f.id)).map((h) => [h.action, h.actorName, (h.detail as { business?: string }).business])).toEqual([
      ["detach", "Ann", "Acme Bakery"],
      ["attach", "Bo", "Acme Bakery"],
      ["upload", "Ann", undefined],
    ]);
    await deleteFile(db, tenantId, g.id, ANN);
    expect(await filesOfLead(db, tenantId, id)).toEqual([]);
    expect(attachmentsLine([])).toBe("");
    const other = await createTenant(db, "Bravo", "bravo", { email: "o@bravo.example", name: "B" });
    expect((await setAttached(db, other.tenant.id, id, f.id, { userId: other.owner.id, name: "B", role: "owner" }, true)).ok).toBe(false);
  });
});

describe("the local stand-in for the bucket", () => {
  it("stores and serves the bytes in development and the tests, never pretending to be the bucket", async () => {
    process.env.FILES_DIR = mkdtempSync(path.join(tmpdir(), "peek-files-"));
    const st = await storage();
    expect(st?.kind).toBe("local");
    await writeLocal("t/abc.pdf", new TextEncoder().encode("%PDF-1.4 test"));
    expect(await st!.size("t/abc.pdf")).toBe(13);
    expect(String(await readLocal("t/abc.pdf"))).toBe("%PDF-1.4 test");
    expect(await st!.uploadUrl("t/abc.pdf", "application/pdf", "id1")).toEqual({ url: "/api/files/local/id1", headers: { "Content-Type": "application/pdf" } });
    await st!.remove("t/abc.pdf");
    expect(await st!.size("t/abc.pdf")).toBeNull();
    expect(await st!.size("../../etc/passwd")).toBeNull(); // no way out of the folder
  });
});
