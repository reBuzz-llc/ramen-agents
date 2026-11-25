import { sessionHint } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadToOpen } from "@/lib/deep-links";
import { readsWith } from "@/lib/session-hint";
import { boardCount, cachedRows, FIRST_ROWS, slimRow } from "@/lib/board-cache";
import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import { researchFirst } from "@/lib/research-first";
import { sendNext } from "@/lib/send-next";
import type { TableRow } from "./lead-table";
import LeadsView from "./leads-view";
import { FILTER_KEYS, leadsTab } from "@/lib/lead-filters";
import { displayName } from "@/lib/display-name";
import { getViewPrefs } from "@/lib/view-prefs-db";

export const metadata = { title: "Leads · Productive Peek" };

/** The Leads board, the team's working board: the table (and the Table tab, every cell as a grid), a drawer to edit a lead and take its next
 *  step, and the Send next tab. People edit here; bots write through the API under the store's rules. */
export default async function LeadsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const d = await db();
  const sp = await props.searchParams;
  // Send next is the first tab and the default; Board and Table by ?tab=.
  const tab = leadsTab(sp.tab);
  // Speed: Send next needs no board rows, only the count; the Board and the Table carry their
  // first rows and the browser fetches the rest from /api/leads/rows (cached on the board's fingerprint, 304 when
  // unchanged). The Table tab reads every cell; the Board only the list columns.
  // Every read at once (from the Mac each database round trip to ap-southeast-2 is ~280 ms; the lead
  // to open and the person's view were two more trips after these): the drawer to open (?lead=<id>, canonical; ?open=<id>
  // from older links; or one line says it isn't available) and the person's own drawer view (Settings → My
  // view; null when it cannot be read, and the drawer uses this browser's).
  // Research first: the leads waiting for a person's pain point; read on every tab for its count
  // They start alongside the sign-in check and are used only if it passes for this person (lib/session-hint.ts);
  // pageMe sends anyone it refuses to sign-in, so `got` is always there below.
  const got = await readsWith(await sessionHint(), () => pageMe(), ({ tenantId, userId }) =>
    Promise.all([
      tab === "send" || tab === "research" || tab === "followup" ? Promise.resolve(null) : cachedRows(d, tenantId, userId, tab),
      boardCount(d, tenantId),
      sendNext(d, tenantId),
      leadToOpen(d, tenantId, sp.lead ?? sp.open),
      getViewPrefs(d, tenantId, userId).catch(() => null),
      researchFirst(d, tenantId),
    ]),
  );
  const { who, data: [first, total, next, toOpen, view, research] } = got!;
  // the Table's first rows without their long cells (about half the first paint's bytes); the full rows bring
  // them a moment later and the view merges the two (leads-view.tsx)
  const board = (first?.rows.slice(0, FIRST_ROWS).map((r) => (tab === "table" ? slimRow(r) : r)) ?? []) as unknown as TableRow[];
  const { openId, unavailable } = toOpen;
  // filters in the address (the Guide's links, e.g. ?tab=board&whatsapp=WhatsApp%20Verified): the board opens filtered
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.slice(0, 200) ?? "";
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, one(sp[k])]).filter(([, v]) => v));
  return <LeadsView rows={board} total={total} next={next} research={research} me={{ userId: who.userId, name: displayName(who.name, who.email) }} tab={tab} canImport={can(who.role, "leads.import")} canMarkSent={can(who.role, "leads.markSent")} canSampleTest={can(who.role, "week.team")} openId={openId} unavailable={unavailable} filters={filters} view={view} />;
}
