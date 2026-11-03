import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { canChange, listFiles } from "@/lib/files";
import { pageMe } from "@/lib/page-me";
import { storage } from "@/lib/storage";
import FilesView, { type FileItem } from "./files-view";

export const metadata = { title: "Files · ramen-agents" };

/** The team's files: PDFs, and PNG/JPG for logos, to attach to emails by hand. */
export default async function FilesPage() {
  const who = await pageMe("/files");
  const d = await db();
  const [rows, st, pkgs] = await Promise.all([
    listFiles(d, who.tenantId),
    storage(),
    d.selectDistinct({ p: leads.package }).from(leads).where(sql`${leads.tenantId} = ${who.tenantId} and ${leads.package} is not null`),
  ]);
  const items: FileItem[] = rows.map((f) => ({
    id: f.id,
    name: f.name,
    size: f.size,
    type: f.contentType,
    tag: f.tag,
    uploader: f.uploader,
    at: f.createdAt.toISOString(),
    attachedTo: f.attachedTo,
    canChange: canChange({ userId: who.userId, role: who.role }, f),
  }));
  return <FilesView files={items} packages={pkgs.map((x) => x.p!).filter(Boolean).sort()} ready={!!st} />;
}
