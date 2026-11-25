import { listPackages } from "@/lib/assets";
import { db } from "@/lib/db";
import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import PackagesView from "./packages-view";

export const metadata = { title: "Packages · Productive Peek" };

/** The packages, on their own page and in the top bar; they were the Asset page's second list. */
export default async function PackagesPage() {
  const who = await pageMe("/packages");
  const d = await db();
  const packages = await listPackages(d, who.tenantId);
  return <PackagesView packages={packages} canEdit={can(who.role, "assets.edit")} isOwner={who.role === "owner"} />;
}
