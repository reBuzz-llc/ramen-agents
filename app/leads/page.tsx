import { db } from "@/lib/db";
import { leadToOpen } from "@/lib/deep-links";
import { boardOf, tableOf } from "@/lib/leads";
import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import { sendNext } from "@/lib/send-next";
import type { TableRow } from "./lead-table";
import LeadsView, { FILTER_KEYS } from "./leads-view";

export const metadata = { title: "Leads · ramen-agents" };

/** The Leads board, the team's working board: the table (and the Table tab, every cell as a grid), a drawer to edit a lead and take its next
 *  step, and the Send next tab. People edit here; bots write through the API under the store's rules. */
export default async function LeadsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const who = await pageMe();
  const d = await db();
  const sp = await props.searchParams;
  // Send next is the first tab and the default; Board and Table by ?tab=.
  const tab = sp.tab === "board" ? "board" : sp.tab === "table" ? "table" : "send";
  // The Table tab reads every cell; the Board and Send next only the list columns.
  const [rows, next] = await Promise.all([tab === "table" ? tableOf(d, who.tenantId, who.userId) : boardOf(d, who.tenantId, who.userId), sendNext(d, who.tenantId)]);
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null | undefined));
  const board: TableRow[] = rows.map((r) => {
    const x = r as typeof r & { sentAt?: Date | null; createdAt?: Date };
    return { ...r, hasDraft: !!r.hasDraft, mine: !!r.mine, corrected: !!r.corrected, openFlags: Number(r.openFlags ?? 0), updatedAt: r.updatedAt.toISOString(), sentAt: iso(x.sentAt), createdAt: iso(x.createdAt) ?? undefined };
  });
  // the drawer to open (from <peek>/leads/<id>, which checked the company); the drawer reads the lead itself
  // the lead the address names (?lead=<id>, canonical; ?open=<id> from older links): its drawer opens, or one line says
  // it isn't available
  const { openId, unavailable } = await leadToOpen(d, who.tenantId, sp.lead ?? sp.open);
  // filters in the address (the Guide's links, e.g. ?tab=board&whatsapp=WhatsApp%20Verified): the board opens filtered
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.slice(0, 200) ?? "";
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, one(sp[k])]).filter(([, v]) => v));
  return <LeadsView rows={board} next={next} me={{ userId: who.userId, name: who.name || who.email }} tab={tab} canImport={can(who.role, "leads.import")} openId={openId} unavailable={unavailable} filters={filters} />;
}
