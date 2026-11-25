import { redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leadImports, leads } from "@/lib/db/schema";
import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import ImportView from "./import-view";

export const metadata = { title: "Import leads · Productive Peek" };

/** Import leads from a CSV or spreadsheet: anyone; a member sees their own past imports. */
export default async function ImportPage() {
  const who = await pageMe("/leads/import");
  if (!can(who.role, "leads.import")) redirect("/leads?tab=board");
  const d = await db();
  const [past, pkgs] = await Promise.all([
    d.select().from(leadImports).where(and(eq(leadImports.tenantId, who.tenantId), can(who.role, "leads.importsAll") ? undefined : eq(leadImports.byUserId, who.userId))).orderBy(desc(leadImports.at)).limit(10),
    d.selectDistinct({ p: leads.package }).from(leads).where(sql`${leads.tenantId} = ${who.tenantId} and ${leads.package} is not null`),
  ]);
  return (
    <ImportView
      past={past.map((p) => ({ id: p.id, at: p.at.toISOString(), by: p.byName, file: p.fileName, created: p.created, skipped: p.skipped, rejected: p.rejected }))}
      packages={pkgs.map((x) => x.p!).filter(Boolean).sort()}
    />
  );
}
