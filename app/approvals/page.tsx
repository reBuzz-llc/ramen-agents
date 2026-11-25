import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { asksForOwner, listBenches } from "@/lib/owner-asks";
import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import { pageLead, pageTitle } from "@/lib/ui-classes";
import ApprovalsView from "./approvals-view";

export const metadata = { title: "Approvals · Productive Peek", robots: { index: false } };

/** What only the owner can say yes to. A LinkedIn post, word for word, and a billing bench. */
export default async function ApprovalsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const who = await pageMe("/approvals");
  if (!can(who.role, "owner.answers")) notFound();
  const sp = await props.searchParams;
  const d = await db();
  const [asks, benches] = await Promise.all([asksForOwner(d, who.tenantId), listBenches(d, who.tenantId)]);
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  return (
    <>
      <h1 className={pageTitle}>Approvals</h1>
      <p className={pageLead}>Nothing here happens until you press. A post goes out only with the exact words and place you approved, once.</p>
      <ApprovalsView asks={asks} benches={benches} focusAsk={one(sp.ask)} focusBench={one(sp.bench)} />
    </>
  );
}
