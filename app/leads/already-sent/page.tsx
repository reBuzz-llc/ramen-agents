import { redirect } from "next/navigation";
import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import AlreadySentView from "./already-sent-view";
import { displayName } from "@/lib/display-name";

export const metadata = { title: "Mark already sent · Productive Peek" };

/** Leads → Mark already sent: owners and managers re-mark the sends the rebuilt board lost. */
export default async function AlreadySentPage() {
  const who = await pageMe("/leads/already-sent");
  if (!can(who.role, "leads.markSent")) redirect("/leads");
  return <AlreadySentView me={displayName(who.name, who.email)} />;
}
