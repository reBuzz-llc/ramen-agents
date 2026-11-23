import { currentIdentity } from "@/lib/identity";
import WorkPlanView from "../../work-plan-view";

export const metadata = { title: "Leads · Work plan · Bot Dashboard" };

// One section of the Work plan on its own page, loading only its own data (owner, 2026-10-31).
export default async function WorkPlanLeadsPage() {
  return <WorkPlanView identity={await currentIdentity()} tab="leads" />;
}
