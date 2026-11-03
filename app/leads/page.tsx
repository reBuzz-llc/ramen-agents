import { db } from "@/lib/db";
import { boardOf } from "@/lib/leads";
import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import { sendNext } from "@/lib/send-next";
import LeadsView, { type BoardRow } from "./leads-view";

export const metadata = { title: "Leads · ramen-agents" };

/** The Leads board, the team's working board: the table, a drawer to edit a lead and take its next
 *  step, and the Send next tab. People edit here; bots write through the API under the store's rules. */
export default async function LeadsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const who = await pageMe();
  const d = await db();
  const [rows, next] = await Promise.all([boardOf(d, who.tenantId, who.userId), sendNext(d, who.tenantId)]);
  const board: BoardRow[] = rows.map((r) => ({ ...r, hasDraft: !!r.hasDraft, mine: !!r.mine, corrected: !!r.corrected, openFlags: Number(r.openFlags ?? 0), updatedAt: r.updatedAt.toISOString() }));
  const sp = await props.searchParams;
  const tab = sp.tab === "send" ? "send" : "board";
  // the drawer to open (from <peek>/leads/<id>, which checked the company); the drawer reads the lead itself
  const openId = typeof sp.open === "string" && /^[0-9a-f-]{36}$/i.test(sp.open) ? sp.open : null;
  return <LeadsView rows={board} next={next} me={{ userId: who.userId, name: who.name || who.email }} tab={tab} canImport={can(who.role, "leads.import")} openId={openId} />;
}
