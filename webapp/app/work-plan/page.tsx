import { currentIdentity } from "@/lib/identity";
import WorkPlanView from "../work-plan-view";

export const metadata = { title: "Work plan · Bot Dashboard" };

export default async function WorkPlanPage() {
  // The wordmark is the way home; the bot pages a back button used to return to are gone (owner, 2026-10-30).
  return <WorkPlanView identity={await currentIdentity()} />;
}
