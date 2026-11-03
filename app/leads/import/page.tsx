import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leadImports, leads } from "@/lib/db/schema";
import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import ImportView from "./import-view";

export const metadata = { title: "Import leads · ramen-agents" };

/** Import leads from a CSV or spreadsheet: owners and managers. */
export default async function ImportPage() {
  const who = await pageMe("/leads/import");
  if (!can(who.role, "leads.import")) redirect("/leads");
  const d = await db();
  const [past, pkgs] = await Promise.all([
    d.select().from(leadImports).where(eq(leadImports.tenantId, who.tenantId)).orderBy(desc(leadImports.at)).limit(10),
    d.selectDistinct({ p: leads.package }).from(leads).where(sql`${leads.tenantId} = ${who.tenantId} and ${leads.package} is not null`),
  ]);
  return (
    <ImportView
      past={past.map((p) => ({ id: p.id, at: p.at.toISOString(), by: p.byName, file: p.fileName, created: p.created, skipped: p.skipped, rejected: p.rejected }))}
      packages={pkgs.map((x) => x.p!).filter(Boolean).sort()}
    />
  );
}
