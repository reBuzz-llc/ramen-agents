import { listPackages, listRates } from "@/lib/assets";
import { db } from "@/lib/db";
import { listFiles } from "@/lib/files";
import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import AssetView from "./asset-view";

export const metadata = { title: "Asset · ramen-agents" };

/** What the company sells: the rate card and
 *  the packages, edited by the owner and managers, read by everyone and by the bots (GET /v1/assets/*); the brochures
 *  and PDFs are the Files page's own. */
export default async function AssetPage() {
  const who = await pageMe("/asset");
  const d = await db();
  const [rates, packages, files] = await Promise.all([listRates(d, who.tenantId), listPackages(d, who.tenantId), listFiles(d, who.tenantId)]);
  const pdfs = files.filter((f) => f.contentType === "application/pdf").map((f) => ({ id: f.id, name: f.name, tag: f.tag, size: f.size }));
  return <AssetView rates={rates} packages={packages} pdfs={pdfs} canEdit={can(who.role, "assets.edit")} isOwner={who.role === "owner"} />;
}
