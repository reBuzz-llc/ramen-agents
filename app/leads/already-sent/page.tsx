import { redirect } from "next/navigation";
import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import AlreadySentView from "./already-sent-view";
import { displayName } from "@/lib/display-name";

export const metadata = { title: "Mark already sent · ramen-agents" };

/** Leads → Mark already sent: owners and managers mark the sends the board does not know about. */
export default async function AlreadySentPage() {
  const who = await pageMe("/leads/already-sent");
  if (!can(who.role, "leads.import")) redirect("/leads");
  return <AlreadySentView me={displayName(who.name, who.email)} />;
}
