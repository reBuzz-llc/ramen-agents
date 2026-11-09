import { db } from "@/lib/db";
import { pageMe } from "@/lib/page-me";
import { settingsTitle } from "@/lib/settings-nav";
import { getViewPrefs } from "@/lib/view-prefs-db";
import SectionHead from "../section-head";
import MyViewEditor from "./editor";

export const metadata = { title: settingsTitle("my-view") };

/** Settings → My view: every person arranges their own lead drawer. */
export default async function MyView() {
  const who = await pageMe("/settings/my-view");
  const view = await getViewPrefs(await db(), who.tenantId, who.userId);
  return (
    <>
      <SectionHead slug="my-view" />
      <MyViewEditor initial={view} />
    </>
  );
}
