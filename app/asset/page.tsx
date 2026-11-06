import { listRates, listSections } from "@/lib/assets";
import { db } from "@/lib/db";
import { listFiles } from "@/lib/files";
import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import AssetView from "./asset-view";

export const metadata = { title: "Asset · ramen-agents" };

/** "What we have" (the packages have their own page): the
 *  sections and the rate card, edited by the owner and managers, read by everyone and by the bots (GET /v1/assets/*);
 *  the brochures and PDFs are the Files page's own. */
export default async function AssetPage() {
  const who = await pageMe("/asset");
  const d = await db();
  const [sections, rates, files] = await Promise.all([listSections(d, who.tenantId), listRates(d, who.tenantId), listFiles(d, who.tenantId)]);
  const pdfs = files.filter((f) => f.contentType === "application/pdf").map((f) => ({ id: f.id, name: f.name, tag: f.tag, size: f.size }));
  return <AssetView sections={sections} rates={rates} pdfs={pdfs} canEdit={can(who.role, "assets.edit")} />;
}
