"use client";
// The Leads board, the team's working board. Board tab: a filterable table (status, borough,
// industry group, score, draft, role, Mine, Corrected by the team) with status chips; Table tab: the same filters over
// every cell as a grid (lead-table.tsx); a row in either opens the drawer, where a
// person edits any cell (saved as that person into the lead's history), takes the next step with one click, takes the
// lead, and copies a draft. Send next tab: the Validator's pick of what to send next, with take, copy and mark sent.
import Link from "next/link";
import PixelLoader from "@/app/pixel-loader";
import { useFollowUpCount } from "@/app/use-follow-up-count";
import FollowUpView from "./follow-up-view";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { leadPath } from "@/lib/deep-links";
import { agentName } from "@/lib/agent-names";
import { navOf, type LeadNav } from "@/lib/lead-nav";
import { EDITED_FILTERS, editedMatches, FILTER_KEYS, industryGroup, leadsTab, NOT_TAKEN, SITE_FILTERS, siteMatches, toolOptions, toolsMatch } from "@/lib/lead-filters";
import { phoneDiffers } from "@/lib/sample-contact";
import { readShowEmpty, writeShowEmpty } from "@/lib/drawer-prefs";
import { activityOf } from "@/lib/activity";
import type { SendLog } from "@/lib/lead-sends";
import { withSample } from "@/lib/sample-site";
import { firstMessageLink, hasReplied } from "@/lib/send-test";
import { shareText, type ShareChange } from "@/lib/team-share";
import { clampDrawer, DEFAULT_VIEW, DRAWER_WIDTH, drawerOrder, fieldLabel as label, type ViewPrefs } from "@/lib/view-prefs";
import { withAttachments } from "@/lib/attachment-line";
import { telHref } from "@/lib/phone";
import { CONTACT_ROLES, EMAIL_STATUSES, emailSteps, LINKEDIN_VIA, READ_ONLY, RESULTS, splitAtDraft, WHATSAPP_STATUSES, type Step } from "@/lib/lead-workflow";
import { hasPictures, isDocsPaste, PICTURES_NOTE, plainOf, RICH_FIELDS, richWithEnding, textToHtml } from "@/lib/rich-text";
import { cleanPaste, copyRich, RichBody, RichEditor } from "./rich-cell";
import { leadTracks } from "@/lib/lead-track";
import { siteHealthShort } from "@/lib/site-health-short";
import LeadTracks from "./lead-track";
import { SampleBox } from "./sample-box";
import TakeControl, { type Holder } from "./take-control";
import type { ResearchFirst } from "@/lib/research-first";
import type { SendNext } from "@/lib/send-next";
import { control, Field } from "../ui";
import { Chip } from "./chip";
import LeadTable, { type TableRow } from "./lead-table";

export type BoardRow = {
  id: string;
  business: string;
  website: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  contactPerson: string | null;
  contactRole: string | null;
  package: string | null;
  leadScore: number | null;
  emailStatus: string | null;
  whatsappStatus: string | null;
  result: string | null;
  sentBy: string[] | null;
  hasDraft: boolean;
  hasWhatsapp: boolean;
  takenBy: string | null;
  toolsOnSite?: string[] | null;
  mine: boolean;
  corrected: boolean;
  updatedAt: string;
};
type Me = { userId: string; name: string };
type Choices = { package: string[]; industry: string[]; location: string[] };

type F = { q: string; email: string; whatsapp: string; city: string; industry: string; taken: string; edited: string; tools: string; site: string; mine: boolean; corrected: boolean };
const NONE: F = { q: "", email: "", whatsapp: "", city: "", industry: "", taken: "", edited: "", tools: "", site: "", mine: false, corrected: false };
/** The text filters a link may set in the address (?whatsapp=WhatsApp%20Verified): the Guide links the board filtered. */
const NOT_SET = "(not set)";

function counts(rows: BoardRow[], key: (r: BoardRow) => string) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function matches(r: BoardRow, f: F, now: number) {
  if (f.q) {
    const hay = `${r.business} ${r.website ?? ""} ${r.contactPerson ?? ""} ${r.industry ?? ""} ${r.city ?? ""}`.toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  if (f.email && (r.emailStatus ?? NOT_SET) !== f.email) return false;
  if (f.whatsapp && (r.whatsappStatus ?? NOT_SET) !== f.whatsapp) return false;
  if (f.city && (r.city || NOT_SET) !== f.city) return false;
  if (f.industry && industryGroup(r.industry ?? "") !== f.industry) return false;
  if (f.taken && (r.takenBy || NOT_TAKEN) !== f.taken) return false;
  if (!editedMatches(r.updatedAt, f.edited, now)) return false;
  if (!toolsMatch(r.toolsOnSite, f.tools)) return false;
  if (!siteMatches(r, f.site)) return false;
  if (f.mine && !r.mine) return false;
  if (f.corrected && !r.corrected) return false;
  return true;
}

/** The pill row under Search: with nothing typed, the board's most common boroughs and industries; while typing, the
 *  businesses, places and industries that contain it. A tap puts the pill's word in the search. */
export function searchHints(rows: BoardRow[], q: string): { kind: string; value: string; count: number }[] {
  const tally = (pick: (r: BoardRow) => string | null, kind: string) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const v = pick(r)?.trim();
      if (v) m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m].map(([value, count]) => ({ kind, value, count }));
  };
  const places = tally((r) => r.city, "in");
  const trades = tally((r) => r.industry, "industry");
  const typed = q.trim().toLowerCase();
  if (!typed) {
    const top = (xs: typeof places) => xs.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, 4);
    return [...top(places), ...top(trades)];
  }
  const hit = (x: { value: string }) => x.value.toLowerCase().includes(typed) && x.value.toLowerCase() !== typed;
  const names = tally((r) => r.business, "business");
  return [...places.filter(hit), ...trades.filter(hit), ...names.filter(hit)].sort((a, b) => b.count - a.count).slice(0, 8);
}

function Pick({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <Field label={label} className="min-w-0">
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${control} ${value ? "border-accent" : ""}`}>
        <option value="">Any</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Toggle({ label, on, set, count }: { label: string; on: boolean; set: (v: boolean) => void; count?: number }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => set(!on)}
      className={`inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm ${on ? "border-accent bg-accent-tint font-semibold" : "border-line bg-panel hover:border-accent"}`}
    >
      {on ? <span aria-hidden>✓</span> : null}
      {label}
      {count !== undefined ? <span className="text-xs text-muted tabular-nums">{count}</span> : null}
    </button>
  );
}

const NO_ROWS: TableRow[] = [];

export default function LeadsView({
  rows: firstRows,
  total = firstRows.length,
  next,
  research = { generatedAt: null, bar: null, rows: [], wait: 0, long: 0 },
  me,
  tab: serverTab,
  canImport = false,
  canMarkSent = false,
  canSampleTest = false,
  openId = null,
  unavailable = false,
  filters = {},
  view = null,
}: {
  rows: TableRow[];
  /** Every live lead's count: the page carries the first rows, the rest come from /api/leads/rows. */
  total?: number;
  next: SendNext;
  /** Research first: the leads waiting for a person's pain point, from the Validator's list. */
  research?: ResearchFirst;
  me: Me;
  tab: "board" | "table" | "send" | "followup" | "research";
  canImport?: boolean;
  /** Mark already sent: owners and managers (a member imports). */
  canMarkSent?: boolean;
  /** Owners and managers see the sample link test's results. */
  canSampleTest?: boolean;
  openId?: string | null;
  unavailable?: boolean;
  filters?: Partial<Record<(typeof FILTER_KEYS)[number], string>>;
  view?: ViewPrefs | null;
}) {
  // The whole board: the page brings the first rows at once and the rest arrive from
  // /api/leads/rows, which answers 304 while the board is unchanged (the browser keeps its copy). After an edit the page
  // refreshes, the first rows come in fresh and the whole board is asked again; until it arrives, the fresh rows are laid
  // over the copy held, so an edit shows at once.
  // The tabs switch in the browser. The address is the source of which tab is open; a tab's rows are kept once they
  // came, and asked again each time it opens (304 while the board is unchanged). Send next and Research first are read again
  // behind what is on the screen, so a teammate's mark appears within a moment.
  const router = useRouter();
  const tab = leadsTab(useSearchParams().get("tab"));
  const [held, setHeld] = useState<Partial<Record<"board" | "table", TableRow[]>>>({});
  const heldTabs = useRef(new Set<string>());
  const base = tab === serverTab ? firstRows : NO_ROWS;
  useEffect(() => {
    if (tab === "send" || tab === "followup" || tab === "research" || (tab === serverTab && firstRows.length >= total)) return;
    let live = true;
    const load = (more: string) => fetch(`/api/leads/rows?tab=${tab}${more}`, { credentials: "same-origin" }).then((r) => (r.ok ? (r.json() as Promise<{ rows: TableRow[] }>) : null));
    const keep = (list?: TableRow[]) => {
      if (!live || !list) return;
      heldTabs.current.add(tab);
      setHeld((h) => ({ ...h, [tab]: list }));
    };
    void (async () => {
      if (tab !== serverTab && !heldTabs.current.has(tab)) keep((await load("&first=1"))?.rows);
      if (live) keep((await load(""))?.rows);
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [firstRows, serverTab, tab, total]);
  const full = tab === "board" || tab === "table" ? (held[tab] ?? null) : null;
  const rows = useMemo(() => {
    if (!full || base.length >= total) return base;
    const fresh = new Map(base.map((r) => [r.id, r]));
    // merged, not replaced: the Table's first rows come without their long cells, the full rows keep them
    return full.map((r) => (fresh.has(r.id) ? ({ ...r, ...fresh.get(r.id) } as TableRow) : r));
  }, [full, base, total]);
  const loading = tab !== "send" && tab !== "followup" && tab !== "research" && rows.length < total;
  // a tab with nothing to show yet
  const pendingTab: string | null = loading && rows.length === 0 ? tab : null;
  const followUps = useFollowUpCount();
  const goTab = (key: typeof tab) => (e: React.MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // a new tab or window stays a normal link
    e.preventDefault();
    if (key === tab) return;
    const u = new URL(window.location.href);
    if (key === "send") u.searchParams.delete("tab");
    else u.searchParams.set("tab", key);
    window.history.pushState(null, "", u);
    if (key === "send" || key === "research") router.refresh();
  };
  const [f, setF] = useState<F>({ ...NONE, ...filters });
  // the moment the Last edited filter measures from: held, so a redraw cannot move a row in or out
  const [filterNow] = useState(() => Date.now());
  // the open drawer lives in the address, /leads?lead=<id>: a load with it opens that lead
  const [open, setOpen] = useState<string | null>(openId);
  // the drawer's width, dragged by its left edge: saved on the person, and kept here so the next
  // drawer opened on this page has it at once
  const [drawerWidth, setDrawerWidth] = useState<number | null>(view?.drawer_width ?? null);
  const [gone, setGone] = useState(unavailable);
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (open) u.searchParams.set("lead", open);
      else u.searchParams.delete("lead");
      u.searchParams.delete("open"); // the older parameter becomes the canonical one
      if (u.href !== window.location.href) window.history.replaceState(window.history.state, "", u);
    } catch {
      /* an address the browser will not rewrite: the drawer still works */
    }
  }, [open]);
  // the filters in the address as they change, so a filtered view can be shared or reloaded
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      for (const k of FILTER_KEYS) {
        if (f[k]) u.searchParams.set(k, f[k]);
        else u.searchParams.delete(k);
      }
      if (u.href !== window.location.href) window.history.replaceState(window.history.state, "", u);
    } catch {
      /* an address the browser will not rewrite: the filters still work */
    }
  }, [f]);
  // the count beside each "No website" chip: the rows it would show under the other filters
  const siteCounts = useMemo(() => {
    const rest = rows.filter((r) => matches(r, { ...f, site: "" }, filterNow));
    return Object.fromEntries(SITE_FILTERS.map(([k]) => [k, rest.filter((r) => siteMatches(r, k)).length]));
  }, [rows, f, filterNow]);
  // a load that names a lead: its row scrolled into view, the filters as they were
  useEffect(() => {
    if (!openId) return;
    const t = setTimeout(() => document.querySelector(`[data-lead="${openId}"]`)?.scrollIntoView({ block: "center" }), 50);
    return () => clearTimeout(t);
  }, [openId]);
  const shown = useMemo(() => rows.filter((r) => matches(r, f, filterNow)), [rows, f, filterNow]);
  // The panel's arrows walk the list on screen. The list is noted when a lead is opened, so a lead that a save takes
  // out of the filter does not lose its place; a link that opens a lead uses the list as it stands.
  const [tableOrder, setTableOrder] = useState<string[]>([]);
  const [followOrder, setFollowOrder] = useState<string[]>([]);
  const [trail, setTrail] = useState<string[] | null>(null);
  const order = useMemo(
    () => (tab === "table" ? tableOrder : tab === "board" ? shown.map((r) => r.id) : tab === "followup" ? followOrder : tab === "research" ? research.rows.map((r) => r.id) : next.rows.map((r) => r.id)),
    [tab, tableOrder, shown, followOrder, research.rows, next.rows],
  );
  const openLead = (id: string) => {
    setTrail(order);
    setOpen(id);
  };
  const closeLead = useCallback(() => {
    setOpen(null);
    setTrail(null);
  }, []);
  const stepTo = useCallback((id: string) => {
    setOpen(id);
    document.querySelector(`[data-lead="${id}"]`)?.scrollIntoView({ block: "nearest" });
  }, []);
  const hints = useMemo(() => searchHints(rows, f.q), [rows, f.q]);
  const on = (k: keyof F) => (v: string | boolean) => setF({ ...f, [k]: v });
  const opts = (key: (r: BoardRow) => string) => counts(rows, key).map(([v, n]) => [v, `${v} (${n})`] as [string, string]);
  // Choices for the drawer's free-text cells: what the board already holds.
  const choices = useMemo<Choices>(
    () => ({
      package: [...new Set(rows.map((r) => r.package).filter(Boolean) as string[])].sort(),
      industry: [...new Set(rows.map((r) => r.industry).filter(Boolean) as string[])].sort(),
      location: [...new Set(rows.filter((r) => r.city).map((r) => [r.city, r.state, "USA"].filter(Boolean).join(", ")))].sort(),
    }),
    [rows],
  );
  // The Table tab takes the window's full width; the title, tabs and filters keep the page's width
  // so they line up with the top bar.
  const wide = tab === "table";
  const narrow = wide ? "mx-auto max-w-[61.5rem]" : "";
  return (
    <div data-wide={wide || undefined}>
      <div className={`flex flex-wrap items-center justify-between gap-3 ${narrow}`}>
        <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">Leads</h1>
        {canImport || canMarkSent || canSampleTest ? (
          <div className="flex flex-wrap gap-2">
            {canSampleTest ? (
              <Link href="/leads/sample-test" className="inline-flex h-11 items-center rounded-full border border-line bg-panel px-4 text-sm font-semibold hover:border-accent">
                Sample link test
              </Link>
            ) : null}
            {/* the sends the rebuilt board lost, re-marked from a person's Sent folder */}
            {canMarkSent ? (
              <Link href="/leads/already-sent" className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-panel px-4 text-sm font-semibold hover:border-accent">
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Mark already sent
              </Link>
            ) : null}
            {canImport ? (
              <Link href="/leads/import" className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-panel px-4 text-sm font-semibold hover:border-accent">
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
                </svg>
                Import CSV
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className={`mt-1 text-[0.9375rem] text-muted ${narrow}`}>Every business on the board, with where it stands. Open one to see its details, its history and what to do next.</p>
      <nav className={`mt-4 border-b border-line text-sm ${narrow}`} aria-label="Leads views">
        <div className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {(
          [
            ["send", "Send next", next.rows.length],
            ["followup", "Follow up", followUps],
            ["research", "Research first", research.wait],
            ["board", "Board", Math.max(rows.length, total)],
            ["table", "Table", Math.max(rows.length, total)],
          ] as const
        ).map(([key, label, n]) => (
          <Link
            key={key}
            href={key === "send" ? "/leads" : `/leads?tab=${key}`}
            prefetch={false}
            onClick={goTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-4 whitespace-nowrap max-[414px]:px-2.5 ${tab === key ? "border-accent font-semibold" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label} <span className="ml-1 rounded-full bg-panel px-1.5 text-xs tabular-nums">{n}</span>
          </Link>
        ))}
        </div>
      </nav>
      {/* a tab on its way: the loading orb and what loads, under the tabs */}
      <div className={narrow}>
        <PixelLoader active={!!pendingTab} label={pendingTab === "table" ? "Loading every cell of every lead…" : pendingTab === "board" ? "Loading the board…" : pendingTab === "research" ? "Loading the leads to research…" : "Loading what to send next…"} />
      </div>
      {tab === "send" ? (
        <SendNextView next={next} me={me} onOpen={openLead} />
      ) : tab === "followup" ? (
        <FollowUpView onOpen={openLead} paused={!!open} onOrder={setFollowOrder} />
      ) : tab === "research" ? (
        <ResearchFirstView research={research} onOpen={openLead} />
      ) : rows.length === 0 && loading ? null : rows.length === 0 ? (
        <p className={`mt-6 rounded-xl border border-line bg-panel p-6 text-sm text-muted ${narrow}`}>No leads here yet. They arrive as the agents find them, or from an import (Leads → Import).</p>
      ) : (
        <>
          <div className={`mt-4 space-y-3 rounded-2xl border border-line bg-panel/50 p-4 ${narrow}`}>
            <Field label="Search">
              <input type="search" value={f.q} onChange={(e) => on("q")(e.target.value)} placeholder="business, contact, industry, city" enterKeyHint="search" className={control} />
            </Field>
            {hints.length ? (
              <div role="group" aria-label={f.q ? "Matches" : "Try"} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
                {hints.map((h) => (
                  <button
                    key={`${h.kind}-${h.value}`}
                    type="button"
                    onClick={() => on("q")(h.value)}
                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-line bg-panel px-3 text-sm whitespace-nowrap hover:border-accent active:bg-accent-tint"
                  >
                    <span className="text-xs text-muted">{h.kind}</span>
                    {h.value}
                    <span className="text-xs text-muted tabular-nums">{h.count}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <Pick label="Email status" value={f.email} onChange={on("email")} options={opts((r) => r.emailStatus ?? NOT_SET)} />
              <Pick label="WhatsApp" value={f.whatsapp} onChange={on("whatsapp")} options={opts((r) => r.whatsappStatus ?? NOT_SET)} />
              <Pick label="Borough / city" value={f.city} onChange={on("city")} options={opts((r) => r.city || NOT_SET)} />
              <Pick label="Industry" value={f.industry} onChange={on("industry")} options={opts((r) => industryGroup(r.industry ?? ""))} />
              <Pick label="Taken by" value={f.taken} onChange={on("taken")} options={opts((r) => r.takenBy || NOT_TAKEN)} />
              <Pick label="Last edited" value={f.edited} onChange={on("edited")} options={EDITED_FILTERS} />
              <Pick label="Tools on site" value={f.tools} onChange={on("tools")} options={toolOptions(rows)} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Quick filters">
                <Toggle label="Mine" on={f.mine} set={on("mine")} />
                <Toggle label="Corrected by the team" on={f.corrected} set={on("corrected")} />
                {SITE_FILTERS.map(([k, label]) => (
                  <Toggle key={k} label={label} count={siteCounts[k]} on={f.site === k} set={(v) => on("site")(v ? k : "")} />
                ))}
              </div>
              <div className="flex items-center gap-4 text-sm">
                {Object.values(f).some(Boolean) ? (
                  <button type="button" onClick={() => setF(NONE)} className="min-h-11 text-accent-ink hover:underline">
                    Clear filters
                  </button>
                ) : null}
                <span className="text-muted tabular-nums" aria-live="polite">
                  {shown.length} of {rows.length}
                  {loading ? (
                    <span className="ml-1">
                      <PixelLoader inline label={`the other ${total - rows.length} loading from the database…`} />
                    </span>
                  ) : null}
                </span>
              </div>
            </div>
          </div>
          {tab === "table" ? (
            <LeadTable rows={shown} onOpen={openLead} onOrder={setTableOrder} columnPrefs={view?.table_columns} />
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-panel">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 font-normal">Business</th>
                    <th className="px-3 py-2 font-normal">Where</th>
                    <th className="px-3 py-2 font-normal">Contact</th>
                    <th className="px-3 py-2 text-right font-normal">Score</th>
                    <th className="px-3 py-2 font-normal">Status</th>
                    <th className="px-3 py-2 font-normal">Draft</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.slice(0, 500).map((r) => (
                    <tr key={r.id} data-lead={r.id} onClick={() => openLead(r.id)} className="cursor-pointer hover:bg-accent-tint">
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => openLead(r.id)} className="text-left font-medium hover:underline">
                          {r.business}
                        </button>
                        <span className="block text-xs text-muted">
                          {r.industry ?? ""}
                          {r.takenBy ? ` · taken by ${r.takenBy}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted">{[r.city, r.state].filter(Boolean).join(", ")}</td>
                      <td className="px-3 py-2">
                        {r.contactPerson ?? <span className="text-muted">-</span>}
                        {r.contactRole ? <span className="block text-xs text-muted">{r.contactRole}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.leadScore ?? <span className="text-muted">-</span>}</td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap gap-1">
                          <Chip status={r.result && r.result !== "Emailed" ? r.result : r.emailStatus} />
                          <Chip status={r.whatsappStatus} />
                          {!r.emailStatus && !r.whatsappStatus && !r.result ? <span className="text-xs text-muted">New</span> : null}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">{r.hasDraft ? "yes" : <span className="text-muted">-</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length > 500 ? <p className="p-3 text-xs text-muted">Showing the first 500; narrow the filters to see the rest.</p> : null}
            </div>
          )}
        </>
      )}
      {gone ? (
        <p role="status" className="fixed inset-x-4 top-20 z-30 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-sm shadow-lg">
          That lead isn&apos;t available to you.
          <button type="button" onClick={() => setGone(false)} aria-label="Dismiss" className="min-h-8 px-1 text-muted hover:text-ink">
            ×
          </button>
        </p>
      ) : null}
      {open ? <Drawer key={open} id={open} me={me} choices={choices} view={view} width={drawerWidth} onWidth={setDrawerWidth} onClose={closeLead} nav={navOf(trail ?? order, open)} onStep={stepTo} /> : null}
    </div>
  );
}

const NO_CHOICES: Choices = { package: [], industry: [], location: [] };

/** The lead's side panel for a page other than the board (the Taken page). The same drawer: the free-text cells
 *  have no suggestions, as on the Send next tab. */
export function LeadPanel({ id, me, view, onClose, order, onStep }: { id: string; me: Me; view: ViewPrefs | null; onClose: () => void; order?: string[]; onStep?: (id: string) => void }) {
  const [width, setWidth] = useState<number | null>(view?.drawer_width ?? null);
  return <Drawer key={id} id={id} me={me} choices={NO_CHOICES} view={view} width={width} onWidth={setWidth} onClose={onClose} nav={order ? navOf(order, id) : null} onStep={onStep} />;
}

type Lead = Record<string, unknown>;
type Change = { id: number; column: string; old: unknown; new: unknown; actor: { kind: string; name: string; via: string | null }; at: string; outcome: string; reason: string | null };
type Saved = { ok: boolean; changes?: number[]; error?: string; lead?: Lead; history?: Change[]; refused?: { field: string; reason: string }[]; sendLog?: SendLog | null; rich?: Record<string, string | null> | null };

type LeadRead = { lead: Lead; history: Change[]; attachments?: Attached[]; sendLog?: SendLog | null; rich?: Record<string, string>; holder?: Holder | null };
const fetchLead = (id: string): Promise<LeadRead> => fetch(`/api/leads/${id}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
// a lead read when the pointer reaches an arrow, so the step feels instant; used once, within seconds, and dropped by any save
const READY_MS = 10_000;
const ready = new Map<string, { at: number; read: Promise<LeadRead | null> }>();
const readAhead = (id: string) => {
  const hit = ready.get(id);
  if (!hit || Date.now() - hit.at > READY_MS) ready.set(id, { at: Date.now(), read: fetchLead(id).catch(() => null) });
};
async function readLead(id: string): Promise<LeadRead> {
  const hit = ready.get(id);
  ready.delete(id);
  const got = hit && Date.now() - hit.at <= READY_MS ? await hit.read : null;
  return got ?? fetchLead(id);
}

/** Up and down through the list the lead was opened from. */
function LeadArrows({ nav, onStep }: { nav: LeadNav; onStep: (id: string) => void }) {
  const arrow = (to: string | null, name: string, path: string) => (
    <button
      type="button"
      disabled={!to}
      aria-label={name}
      title={name}
      onClick={() => to && onStep(to)}
      onPointerEnter={() => to && readAhead(to)}
      onFocus={() => to && readAhead(to)}
      className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-accent-tint hover:text-accent-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
    >
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={path} />
      </svg>
    </button>
  );
  return (
    <div role="group" aria-label="Move through this list" data-lead-arrows className="inline-flex items-center rounded-full border border-line">
      {arrow(nav.prev, "Previous lead", "M6 15l6-6 6 6")}
      <span className="hidden px-0.5 text-xs whitespace-nowrap text-muted tabular-nums min-[420px]:inline">
        {nav.at.toLocaleString()} of {nav.total.toLocaleString()}
      </span>
      {arrow(nav.next, "Next lead", "M6 9l6 6 6-6")}
    </div>
  );
}

const onResize = (fn: () => void) => {
  window.addEventListener("resize", fn);
  return () => window.removeEventListener("resize", fn);
};

async function patch(id: string, fields: Record<string, unknown>, rich?: Record<string, string | null>): Promise<Saved> {
  ready.clear();
  try {
    const send = (confirmed: boolean) => fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields, confirmed, rich }) });
    let r = await send(false);
    // the Validator's checks found something; the person decides, never blocked
    if (r.status === 409) {
      const w = (await r.json()) as { warn?: string };
      if (w.warn) {
        if (!window.confirm(`${w.warn}\n\nSave anyway?`)) return { ok: false, error: "Not saved." };
        r = await send(true);
      }
    }
    return (await r.json()) as Saved;
  } catch {
    return { ok: false, error: "No answer from the server; check the connection and try again." };
  }
}

async function claim(id: string, action: "accept" | "release"): Promise<{ ok: boolean; error?: string }> {
  ready.clear();
  try {
    const r = await fetch("/api/queue/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId: id, action }) });
    return await r.json();
  } catch {
    return { ok: false, error: "No answer from the server." };
  }
}


function Clip() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
    </svg>
  );
}

type Attached = { id: string; name: string };

/** The lead's Attachments row: the files picked for its email, each with a ×, and "Attach a file…" from the Files page. */
function Attachments({ leadId, initial, onChange }: { leadId: string; initial: Attached[]; onChange: (a: Attached[]) => void }) {
  const [all, setAll] = useState<{ id: string; name: string; tag: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    fetch("/api/files")
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((d) => live && setAll(d.files ?? []))
      .catch(() => live && setAll([]));
    return () => {
      live = false;
    };
  }, []);
  const set = async (fileId: string, on: boolean) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/leads/${leadId}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId, on }) });
      const d = (await r.json()) as { ok: boolean; error?: string; attachments?: Attached[] };
      if (!d.ok) setError(d.error ?? "That failed.");
      else onChange(d.attachments ?? []);
    } catch {
      setError("No answer from the server.");
    } finally {
      setBusy(false);
    }
  };
  const free = (all ?? []).filter((f) => !initial.some((a) => a.id === f.id));
  return (
    <div className="mt-4 rounded-xl border border-line bg-panel p-3">
      <p className="flex items-center gap-1 text-sm font-medium">
        <Clip /> Attachments
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {initial.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-accent-tint py-0.5 pr-1 pl-2.5 text-xs text-accent-ink">
            {a.name}
            <button type="button" disabled={busy} onClick={() => void set(a.id, false)} aria-label={`Take ${a.name} off this email`} className="inline-flex size-6 items-center justify-center rounded-full hover:bg-ink/10">
              ×
            </button>
          </span>
        ))}
        {all === null ? (
          <span className="text-xs text-muted">Loading files…</span>
        ) : free.length ? (
          <select value="" disabled={busy} onChange={(e) => e.target.value && void set(e.target.value, true)} aria-label="Attach a file" className="h-11 rounded-full border border-line bg-bg px-3 text-sm">
            <option value="">Attach a file…</option>
            {free.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.tag ? ` · ${f.tag}` : ""}
              </option>
            ))}
          </select>
        ) : !initial.length ? (
          <a href="/files" className="inline-flex min-h-11 items-center text-sm text-accent-ink hover:underline">
            Upload files on the Files page
          </a>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-xs text-bad">{error}</p> : null}
    </div>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Research first: own-site leads above the Validator's bar wait for a person's pain point,
 *  by the team's research method, before any bot writes one. Highest Lead score first; a lead leaves as soon as a person saves its
 *  pain point (then the Writer may draft it). */
function ResearchFirstView({ research, onOpen }: { research: ResearchFirst; onOpen: (id: string) => void }) {
  return (
    <div className="mt-4">
      <p className="text-sm font-semibold tabular-nums" data-research-head>
        {research.wait} wait{research.long ? ` · ${research.long} more than 7 days` : ""}
      </p>
      <div className="mt-2 rounded-xl border border-line bg-panel p-3 text-sm">
        <p className="font-semibold">How to research one</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">
          <li>Find one problem anyone can check, with its proof: a quote from their site, a page address, or the site and Google saying different things.</li>
          <li>Write it in the three lines: Pain point / They can try / We propose. Save it, and the lead leaves this list.</li>
        </ol>
      </div>
      {research.rows.length === 0 ? (
        <p className="mt-4 rounded-xl border border-line bg-panel p-6 text-sm text-muted">
          Nothing to research right now. The {agentName("Validator")} puts the best own-site leads here{research.bar !== null ? ` (Lead score ${research.bar} and up)` : ""}.
        </p>
      ) : (
        <ol className="mt-3 space-y-2" data-research-list>
          {research.rows.map((r, i) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl border border-line bg-panel p-3 text-sm">
              <button type="button" onClick={() => onOpen(r.id)} className="min-h-9 text-left font-semibold hover:underline">
                {i + 1}. {r.business}
              </button>
              <span className="inline-flex flex-wrap items-center gap-3 text-xs text-muted tabular-nums">
                {r.score !== null ? <span>Lead score {Math.round(r.score)}</span> : null}
                <span>{r.days === 0 ? "new today" : `waiting ${r.days} day${r.days === 1 ? "" : "s"}`}</span>
                {r.website ? (
                  <a href={r.website.startsWith("http") ? r.website : `https://${r.website}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center font-medium text-accent-ink underline">
                    Their site ↗
                  </a>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SendNextView({ next, me, onOpen }: { next: SendNext; me: Me; onOpen: (id: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<Record<string, string>>({});
  const say = (id: string, text: string) => setMsg((m) => ({ ...m, [id]: text }));
  const act = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(id);
    const r = await fn();
    setBusy("");
    say(id, r.ok ? done : (r.error ?? "That failed."));
    if (r.ok) router.refresh();
  };
  if (next.source === "none") {
    return (
      <p className="mt-4 rounded-xl border border-line bg-panel p-6 text-sm text-muted" data-no-send-list>
        Peek has no saved Send next list, so there is nothing to send here. The {agentName("Validator")} saves one when it runs.
      </p>
    );
  }
  const from = next.source === "validator" ? `the ${agentName("Validator")}'s list` : `the ${agentName("Validator")}'s file on this computer`;
  return (
    <div className="mt-4">
      <PixelLoader inline active={!!busy} label="Saving to the database…" />
      <p className="text-sm text-muted">
        From {from}
        {next.generatedAt ? `, made ${next.generatedAt.replace("T", " ").slice(0, 16)}` : ""}. Take a lead, copy its draft into your own mailbox, send it,
        then mark it sent.
        {next.missing ? ` ${next.missing} on the list are not on this board yet.` : ""}
      </p>
      {next.rows.length === 0 ? (
        <p className="mt-4 rounded-xl border border-line bg-panel p-6 text-sm text-muted">
          Nothing to send yet ·{" "}
          <Link href="/guide#pick" className="font-medium text-accent-ink underline">
            read the guide
          </Link>
        </p>
      ) : null}
      <ol className="mt-3 space-y-2">
        {next.rows.map((r, i) => {
          const mine = r.takenBy?.userId === me.userId;
          return (
            <li key={r.id} className="rounded-xl border border-line bg-panel p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <button type="button" onClick={() => onOpen(r.id)} className="text-left font-semibold hover:underline">
                  {i + 1}. {r.business}
                </button>
                <span className="inline-flex items-center gap-2 text-xs text-muted tabular-nums">
                  {r.attachments.length ? (
                    <span title={r.attachments.join(", ")} className="inline-flex items-center gap-0.5" aria-label={`${r.attachments.length} attached`}>
                      <Clip /> {r.attachments.length}
                    </span>
                  ) : null}
                  {r.score !== null ? `score ${r.score}` : "no score"}
                  {r.pkg ? ` · ${r.pkg}` : ""}
                </span>
              </div>
              <p className="mt-1 text-muted">
                {[r.contact, r.role].filter(Boolean).join(", ") || "no contact name"} · {r.email ?? "no email"}
                {r.note ? ` · ${r.note}` : ""}
              </p>
              {r.sampleHeld ? <p className="mt-1 text-xs text-muted">Sample link: send it after they reply.</p> : null}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {r.takenBy && !mine ? (
                  <span className="text-xs text-muted">taken by {r.takenBy.name}</span>
                ) : mine ? (
                  <button type="button" disabled={busy === r.id} onClick={() => act(r.id, () => claim(r.id, "release"), "Given back.")} className="inline-flex min-h-11 items-center text-sm text-muted hover:underline">
                    Give back
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => act(r.id, () => claim(r.id, "accept"), "Taken: it is yours.")}
                    className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover"
                  >
                    Take it
                  </button>
                )}
                {r.draft ? (
                  <button
                    type="button"
                    onClick={async () => say(r.id, (await copy(withAttachments(withSample(r.draft!, r.sample), r.attachments))) ? "Draft copied." : "Copy failed: open the lead and select the draft.")}
                    className="inline-flex min-h-11 items-center text-sm text-accent-ink hover:underline"
                  >
                    Copy draft
                  </button>
                ) : null}
                {mine ? (
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => act(r.id, () => patch(r.id, emailSteps({ email_status: "Ready to Send Email" })[0].fields), "Marked sent.")}
                    className="inline-flex min-h-11 items-center rounded-full border border-accent px-4 text-sm font-semibold hover:bg-accent-tint"
                  >
                    Mark sent
                  </button>
                ) : null}
                {msg[r.id] ? <span className="text-xs text-muted">{msg[r.id]}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {next.held.length ? (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted">Held back ({next.held.length})</summary>
          <ul className="mt-2 space-y-1">
            {next.held.map((h, i) => (
              <li key={i}>
                {h.business} <span className="text-muted">· {h.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "" : Array.isArray(v) ? v.join(", ") : String(v));
/** A cell as the panel shows it. Site health reads short; what is stored does not change. */
const shownCell = (k: string, v: unknown) => (k === "site_health" ? siteHealthShort(show(v)) : show(v));
const isUrl = (v: string) => /^https?:\/\//.test(v);
const LONG = new Set(["pain_point", "draft_email", "draft_whatsapp", "draft_followup", "source_pages", "site_health", "notes"]);
const SELECT: Record<string, string[]> = { contact_role: CONTACT_ROLES, linkedin_via: LINKEDIN_VIA, email_status: EMAIL_STATUSES, whatsapp_status: WHATSAPP_STATUSES, result: RESULTS };
const REASON: Record<string, string> = { research_first: "waiting for a person's research (Research first)", person_wins: "a person changed it last", human_only: "the team's field", filled: "already filled", derived: "worked out from another cell" };

/** Copy link: the lead's canonical address to the clipboard, "Copied" for two seconds. Where the
 *  clipboard is refused, the address shows selected in a field, ready for ⌘C. */
function CopyLink({ id }: { id: string }) {
  const url = typeof window === "undefined" ? leadPath(id) : `${window.location.origin}${leadPath(id)}`;
  return <CopyButton text={url} label="Copy link" title="Copy link to this lead" done="Link copied" field="Link to this lead" icon={<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>} />;
}

/** "Copy for WhatsApp": the business, its link and the team's latest changes, for the group chat. */
function CopyForWhatsApp({ id, business, history }: { id: string; business: string; history: ShareChange[] }) {
  const url = typeof window === "undefined" ? leadPath(id) : `${window.location.origin}${leadPath(id)}`;
  return (
    <CopyButton
      text={() => shareText({ business, url, history })}
      label="Copy for WhatsApp"
      title="Copy a message about this lead for the team's WhatsApp group"
      done="Message copied"
      field="Message for the team's WhatsApp group"
      multiline
      icon={<path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.6-5.4A8.4 8.4 0 1 1 21 11.5z" />}
    />
  );
}

/** A small icon button that copies text, "Copied" for two seconds; where the clipboard refuses, the text is shown
 *  selected to copy by hand. */
function CopyButton({ text, label, title, done, field, icon, multiline = false }: { text: string | (() => string); label: string; title: string; done: string; field: string; icon: React.ReactNode; multiline?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const [shown, setShown] = useState("");
  const copy = async () => {
    const value = typeof text === "function" ? text() : text;
    setShown(value);
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("manual");
    }
  };
  // shown because the clipboard refused: selected, ready to copy by hand
  const select = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    el?.focus();
    el?.select();
  };
  if (state === "manual")
    return multiline ? (
      <textarea readOnly value={shown} aria-label={field} ref={select} onBlur={() => setState("idle")} rows={6} className="w-56 rounded-lg border border-line bg-panel px-2 py-1 text-xs sm:w-72" />
    ) : (
      <input readOnly value={shown} aria-label={field} ref={select} onBlur={() => setState("idle")} className="h-9 w-48 rounded-lg border border-line bg-panel px-2 text-xs sm:w-64" />
    );
  return (
    <button type="button" onClick={() => void copy()} title={label} aria-label={state === "copied" ? done : title} className="group/link inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted hover:text-ink">
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {icon}
      </svg>
      <span className={state === "copied" ? "text-good" : "hidden sm:group-hover/link:inline"}>{state === "copied" ? "Copied" : label}</span>
    </button>
  );
}

export const GUIDE_HINT_KEY = "peek.guide-hint-seen";

/** The drawer's left edge: drag it (or use the arrow keys on it) to widen or narrow the drawer on a
 *  wide screen; the width is saved on the person when the drag ends. A double-click puts back the default. */
function DrawerEdge({ width, onWidth }: { width: number; onWidth: (w: number | null) => void }) {
  const [live, setLive] = useState<number | null>(null);
  const save = (w: number | null) => {
    onWidth(w);
    void fetch("/api/view-prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ drawer_width: w }) }).catch(() => undefined);
  };
  const shown = live ?? width;
  return (
    <button
      type="button"
      aria-label={`Drawer width ${shown} pixels: drag, or use the arrow keys; double-click for the default`}
      title="Drag to resize · double-click for the default width"
      className="group absolute inset-y-0 left-0 z-10 hidden w-3 -translate-x-1/2 cursor-col-resize touch-none sm:block focus-visible:outline-none"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setLive(width);
      }}
      onPointerMove={(e) => {
        if (live === null) return;
        const w = clampDrawer(window.innerWidth - e.clientX, window.innerWidth);
        setLive(w);
        onWidth(w);
      }}
      onPointerUp={() => {
        if (live === null) return;
        save(live);
        setLive(null);
      }}
      onDoubleClick={() => save(null)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 96 : 32;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        save(clampDrawer(width + (e.key === "ArrowLeft" ? step : -step), window.innerWidth));
      }}
    >
      <span aria-hidden className={`absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors ${live !== null ? "bg-accent" : "bg-transparent group-hover:bg-accent/60 group-focus-visible:bg-accent"}`} />
      <span aria-hidden className="absolute top-1/2 left-1/2 h-10 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line group-hover:bg-accent" />
    </button>
  );
}

function Drawer({ id, me, choices, view, width, onWidth, onClose, nav, onStep }: { id: string; me: Me; choices: Choices; view: ViewPrefs | null; width: number | null; onWidth: (w: number | null) => void; onClose: () => void; nav?: LeadNav | null; onStep?: (id: string) => void }) {
  // the window's width, for keeping the drawer inside it (0 until the browser says, so server and browser render alike)
  const viewport = useSyncExternalStore(onResize, () => window.innerWidth, () => 0);
  const drawerPx = viewport ? clampDrawer(width, viewport) : null;
  const router = useRouter();
  const [data, setData] = useState<LeadRead | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  // after a person's rewrite of a Writer draft, the offer to use it for the rest of its group
  const [offer, setOffer] = useState<{ edit_id: number; channel: string; words: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // The person's own view (Settings → My view): their field order, the fields behind "n hidden", and whether
  // empty fields show (default yes). Kept on the person; this browser's copy of "show empty" stands in only
  // when the server's could not be read.
  const order = drawerOrder(view ?? DEFAULT_VIEW);
  const hiddenSet = new Set((view ?? DEFAULT_VIEW).hidden_fields);
  const [showEmpty, setShowEmptyState] = useState(() => {
    if (view) return view.show_empty;
    try {
      return typeof window === "undefined" || readShowEmpty(window.localStorage);
    } catch {
      return true;
    }
  });
  const [revealHidden, setRevealHidden] = useState(false);
  // who holds this lead, from the lead's own read; Take it waits for it, so a taken lead never offers it
  const [got, setGot] = useState<{ id: string; holder: Holder | null } | null>(null);
  const claimed = got?.id === id ? got.holder : undefined;
  const [movingDate, setMovingDate] = useState(false);
  const setShowEmpty = (v: boolean) => {
    setShowEmptyState(v);
    try {
      writeShowEmpty(window.localStorage, v);
    } catch {
      /* storage blocked: the server keeps it */
    }
    void fetch("/api/view-prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ show_empty: v }) }).catch(() => undefined);
  };
  // right after a reply or a win, the one extra click (which channel, the amount)
  const [askSend, setAskSend] = useState(false);
  // the first drawer this browser opens shows one line pointing at the guide's sending steps
  const [hint, setHint] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (localStorage.getItem(GUIDE_HINT_KEY)) return;
        localStorage.setItem(GUIDE_HINT_KEY, new Date().toISOString());
        setHint(true);
      } catch {
        /* private window or storage off: no hint, nothing breaks */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    // read once per lead: this used to run again on every redraw of the page behind, and one failed re-read put "Could not load"
    // over a lead that was loaded
    let live = true;
    readLead(id)
      .then((d) => {
        if (!live) return;
        setError("");
        setData(d);
        setGot({ id, holder: d.holder ?? null });
      })
      .catch(() => live && setError("Could not load this lead. Try again."));
    return () => {
      live = false;
    };
  }, [id]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  // the sticky row names the lead once its title has scrolled out of sight
  const titleBlock = useRef<HTMLDivElement>(null);
  const [titleGone, setTitleGone] = useState(false);
  const hasLead = !!data;
  useEffect(() => {
    const el = titleBlock.current;
    if (!el || !hasLead) return;
    const seen = new IntersectionObserver(([e]) => setTitleGone(!e.isIntersecting), { root: el.closest("aside"), rootMargin: "-60px 0px 0px 0px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, [hasLead]);
  // an edit still open is not lost by a press of an arrow
  const moveTo = useCallback(
    (to: string) => {
      if (document.querySelector("aside[role=dialog] form") && !window.confirm("You have an edit open. Leave it without saving?")) return;
      onStep?.(to);
    },
    [onStep],
  );
  const save = async (fields: Record<string, unknown>, done: string, formatted?: Record<string, string | null>): Promise<boolean> => {
    setBusy(true);
    setMsg("");
    const r = await patch(id, fields, formatted);
    setBusy(false);
    if (!r.ok || !r.lead) {
      setMsg(r.error ?? "Not saved.");
      return false;
    }
    // a saved cell's old formatted copy no longer applies; what the server kept comes back in r.rich
    const rich = { ...data?.rich };
    for (const key of Object.keys(fields)) delete rich[key];
    for (const [key, html] of Object.entries(r.rich ?? {})) if (html) rich[key] = html;
    setData({ lead: r.lead, history: r.history ?? data?.history ?? [], attachments: data?.attachments, sendLog: r.sendLog ?? data?.sendLog, rich });
    setMsg(r.refused?.length ? `Not saved: ${r.refused.map((x) => `${label(x.field)} (${REASON[x.reason] ?? x.reason})`).join(", ")}` : formatted && r.rich === null ? `${done} Its formatting could not be kept.` : done);
    router.refresh();
    setOffer(null);
    if (("draft_email" in fields || "draft_whatsapp" in fields) && r.changes?.length) {
      for (const edit of r.changes) {
        const o = (await fetch(`/api/template-proposals?lead=${encodeURIComponent(id)}&edit=${edit}`).then((x) => x.json()).catch(() => null)) as { offer?: { edit_id: number; channel: string; words: string } | null } | null;
        if (o?.offer) {
          setOffer(o.offer);
          break;
        }
      }
    }
    return true;
  };
  const answerOffer = async (answer: "yes" | "no") => {
    if (!offer) return;
    const r = await fetch("/api/template-proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead: id, edit: offer.edit_id, answer }) })
      .then((x) => x.json()).catch(() => ({ ok: false, error: "No answer from the server." })) as { ok: boolean; error?: string };
    setMsg(r.ok ? (answer === "yes" ? `Saved: your rewrite is the approved template for ${offer.words.replace(/^the other \d+ /, "")}.` : "Kept to this lead only.") : (r.error ?? "Not saved."));
    setOffer(null);
  };
  const step = async (s: Step) => {
    if (busy) return;
    if ((await save(s.fields, `${s.label}: saved.`)) && hasReplied(s.fields.result)) setAskSend(true);
  };
  // Clear, in a status line's menu: empties it and the cells its step set; the line starts over.
  const clear = async (field: "email_status" | "whatsapp_status" | "result", what: string) => {
    setBusy(true);
    setMsg("");
    try {
      ready.clear();
      const res = await fetch(`/api/leads/${id}/clear`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field }) });
      const r = (await res.json()) as { ok: boolean; error?: string; lead?: Lead; history?: Change[]; cleared?: string[]; sendLog?: SendLog | null };
      if (!r.ok || !r.lead) return setMsg(r.error ?? "Not cleared.");
      setData({ lead: r.lead, history: r.history ?? data?.history ?? [], attachments: data?.attachments, sendLog: r.sendLog ?? data?.sendLog, rich: data?.rich });
      setAskSend(false);
      setMsg(`${what} cleared${r.cleared && r.cleared.length > 1 ? `, with ${r.cleared.filter((c) => c !== field).map(label).join(", ")}` : ""}.`);
      router.refresh();
    } catch {
      setMsg("No answer from the server.");
    } finally {
      setBusy(false);
    }
  };
  const take = async (action: "accept" | "release") => {
    setBusy(true);
    const r = await claim(id, action);
    if (!r.ok) {
      // someone else got there first, or it changed hands: show who holds it now
      const now = (await fetch(`/api/leads/${id}`).then((x) => (x.ok ? x.json() : null)).catch(() => null)) as { holder?: Holder | null } | null;
      if (now) setGot({ id, holder: now.holder ?? null });
      setBusy(false);
      return setMsg(r.error ?? "That failed.");
    }
    setBusy(false);
    setGot({ id, holder: action === "accept" ? { userId: me.userId, name: me.name } : null });
    setMsg(action === "accept" ? "Taken: it is yours." : "Given back.");
    router.refresh();
  };
  const lead = data?.lead;
  const tracks = lead ? leadTracks(lead) : [];
  // a lead sent on both channels says which one answered; a win may carry an amount; a held link goes after the reply
  const sends = data?.sendLog?.sends ?? [];
  const needChannel = hasReplied(lead?.result) && sends.length === 2 && !sends.some((x) => x.replied);
  const needAmount = lead?.result === "Client" && (needChannel || sends.some((x) => x.closed && x.amountCents === null));
  const heldLink = lead && hasReplied(lead.result) && sends.some((x) => x.variant === "after_reply") ? show(lead.sample_url) : "";
  const copyHeldLink = async () => {
    if (!(await copy(heldLink))) return setMsg("Copy failed: select the link in Sample site.");
    setMsg("Sample link copied.");
    const r = (await fetch(`/api/leads/${id}/send-log`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link: true }) }).then((x) => x.json()).catch(() => null)) as { sendLog?: SendLog | null } | null;
    if (r?.sendLog) setData((d) => (d ? { ...d, sendLog: r.sendLog } : d));
  };
  const holderNow = claimed ? (claimed.userId === me.userId ? "you" : claimed.name) : null;
  const activity = lead ? activityOf(lead, data?.history ?? [], holderNow ? `Taken by ${holderNow}` : null) : [];
  const visible = order.filter((k) => !hiddenSet.has(k) || revealHidden);
  const keys = visible.filter((k) => showEmpty || shownCell(k, lead?.[k]));
  const empty = lead ? visible.filter((k) => !shownCell(k, lead[k])).length : 0;
  const split = splitAtDraft(keys);
  const attachments = <Attachments leadId={id} initial={data?.attachments ?? []} onChange={(a) => setData((d) => (d ? { ...d, attachments: a } : d))} />;
  const cell = (k: string) =>
    lead && data ? (
      <Cell
        key={k}
        k={k}
        value={lead[k]}
        busy={busy}
        choices={choices}
        rich={data.rich?.[k]}
        copyAs={k === "draft_email" ? (v) => withAttachments(withSample(v, firstMessageLink("email", show(lead.sample_url), data.sendLog?.variant, lead.result)), (data.attachments ?? []).map((a) => a.name)) : k === "draft_whatsapp" ? (v) => withSample(v, firstMessageLink("whatsapp", show(lead.sample_url), data.sendLog?.variant, lead.result)) : undefined}
        onSave={(v, html) => save({ [k]: v }, `${label(k)}: saved.`, html === undefined ? undefined : { [k]: html })}
      />
    ) : null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-ink/30" />
      {/* the frame holds the width and the draggable left edge, which stays put while the drawer scrolls */}
      <div className={`relative h-full w-full ${drawerPx ? "sm:w-[var(--drawer-w)]" : "max-w-xl"}`} style={drawerPx ? ({ "--drawer-w": `${drawerPx}px` } as React.CSSProperties) : undefined}>
      <DrawerEdge width={drawerPx ?? DRAWER_WIDTH.default} onWidth={onWidth} />
      <aside role="dialog" aria-modal="true" aria-label={String(lead?.business ?? "Lead")} className="relative h-full w-full overflow-y-auto bg-bg px-5 pb-5 shadow-xl">
        {/* this row stays at the top while the panel scrolls; once the title has scrolled away it names the lead */}
        <div data-lead-bar className="sticky top-0 z-10 -mx-5 mb-3 flex items-center justify-between gap-2 border-b border-line bg-bg px-5 py-1.5">
          <span data-lead-bar-name aria-hidden={!titleGone} className={`hidden min-w-0 flex-1 truncate text-sm font-semibold transition-opacity sm:block ${titleGone ? "opacity-100" : "opacity-0"}`}>
            {show(lead?.business)}
          </span>
          <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1" data-lead-actions>
            {lead && claimed !== undefined ? <TakeControl holder={claimed} meId={me.userId} busy={busy} onTake={() => void take("accept")} onGiveBack={() => void take("release")} /> : null}
            <CopyLink id={id} />
            {lead ? <CopyForWhatsApp id={id} business={show(lead.business)} history={data?.history ?? []} /> : null}
            {nav && onStep ? <LeadArrows nav={nav} onStep={moveTo} /> : null}
            <button type="button" onClick={onClose} className="min-h-11 px-1 text-sm text-muted hover:text-ink">
              Close
            </button>
          </div>
        </div>
        {hint ? (
          <p role="note" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-accent bg-accent-tint px-3 py-2 text-sm">
            <span>
              First lead? How to send it by hand and record it:{" "}
              <Link href="/guide#send" className="font-medium text-accent-ink underline">
                the guide
              </Link>
              ; for a WhatsApp message,{" "}
              <Link href="/guide#whatsapp-send" className="font-medium text-accent-ink underline">
                this step
              </Link>
              .
            </span>
            <button type="button" aria-label="Hide this hint" onClick={() => setHint(false)} className="min-h-6 shrink-0 px-1 text-muted hover:text-ink">
              ×
            </button>
          </p>
        ) : null}
        <div ref={titleBlock}>
          <div className="min-w-0">
            {lead ? (
              <>
                <HeaderField k="business" value={lead.business} busy={busy} onSave={(v) => save({ business: v }, "Business: saved.")} />
                <HeaderField k="website" value={lead.website} busy={busy} onSave={(v) => save({ website: v }, "Website: saved.")} />
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted">
                  <HeaderField k="location" value={lead.location} busy={busy} choices={choices.location} onSave={(v) => save({ location: v }, "Location: saved.")} />
                  <span aria-hidden>·</span>
                  <HeaderField k="industry" value={lead.industry} busy={busy} choices={choices.industry} onSave={(v) => save({ industry: v }, "Industry: saved.")} />
                </p>
              </>
            ) : (
              <h2 className="text-xl font-bold">…</h2>
            )}
          </div>
        </div>
        {error ? <p className="mt-4 text-sm text-bad">{error}</p> : null}
        {lead ? (
          <>
            {/* nothing is settled for the person; the Phone cell and the send screens keep the row's number */}
            {phoneDiffers(show(lead.phone), lead.site_facts) ? (
              <p data-phone-differs className="mt-4 rounded-xl border border-line bg-panel/60 px-3 py-2 text-sm">
                The listing shows a different phone: <span className="tabular-nums">{phoneDiffers(show(lead.phone), lead.site_facts)}</span>. Check it and update the Phone cell if it is right. Send screens keep using the Phone cell.
              </p>
            ) : null}
            <LeadTracks tracks={tracks} busy={busy} onStep={(x) => void step(x)} onClear={(c) => void clear(c.field, c.what)} />
            <PixelLoader inline active={busy} label="Saving to the database…" />
            {msg && !busy ? (
              <p role="status" className="mt-2 text-sm">
                {msg}
              </p>
            ) : null}
            {askSend && !busy && (needChannel || needAmount) ? (
              <SendAnswer
                id={id}
                channel={needChannel}
                amount={needAmount}
                onDone={(log) => {
                  setAskSend(false);
                  if (log) setData((d) => (d ? { ...d, sendLog: log } : d));
                }}
              />
            ) : null}
            {heldLink && !busy ? (
              <button type="button" onClick={() => void copyHeldLink()} className="mt-2 inline-flex min-h-11 items-center rounded-full border border-accent bg-panel px-3 text-sm font-semibold text-accent-ink">
                Copy sample link
              </button>
            ) : null}
            {offer && !busy ? (
              // asked once, right after the save; no answer leaves it to the owner's Decisions box
              <div role="group" aria-label="Use this rewrite for other leads" className="mt-2 rounded-xl border border-line bg-panel p-3 text-sm" data-template-offer>
                <p>Use your rewritten {offer.channel === "whatsapp" ? "WhatsApp message" : "email"} for {offer.words}? Their names, city and pain point fill in for each.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void answerOffer("yes")} className="rounded-full px-3 py-1.5 text-sm font-semibold" style={{ background: "#ff6600", color: "#1a0d00" }}>Yes, use it for them</button>
                  <button type="button" onClick={() => void answerOffer("no")} className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold">Just this lead</button>
                </div>
              </div>
            ) : null}
            {activity.length ? (
              <section aria-label="Activity" className="mt-4 rounded-xl border border-line bg-panel/60 px-3 py-2">
                <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Activity</h3>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {activity.map((a) => (
                    <li key={a.key} className="flex flex-wrap items-center gap-x-2">
                      {a.text}
                      {a.key === "result" ? (
                        movingDate ? (
                          <form
                            className="inline-flex items-center gap-1"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const v = String(new FormData(e.currentTarget).get("result_date") ?? "");
                              if (v) void save({ result_date: v }, "Result date: saved.").then((ok) => ok && setMovingDate(false));
                            }}
                          >
                            <input type="date" name="result_date" required defaultValue={show(lead.result_date).slice(0, 10)} aria-label="Result date" className="min-h-11 rounded-lg border border-line bg-panel px-2 text-sm" />
                            <button type="submit" disabled={busy} className="min-h-11 px-2 text-sm font-semibold text-accent-ink hover:underline">
                              Save
                            </button>
                            <button type="button" onClick={() => setMovingDate(false)} className="min-h-11 px-1 text-sm text-muted hover:text-ink">
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <button type="button" onClick={() => setMovingDate(true)} className="inline-flex min-h-11 items-center text-xs text-accent-ink hover:underline">
                            Change date
                          </button>
                        )
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {!split ? attachments : null}
            <SampleBox leadId={id} noSite={!show(lead.website)} />
            <dl className="mt-4 space-y-2 text-sm">{(split?.upTo ?? keys).map(cell)}</dl>
            {/* Attachments directly under the draft email; with no draft showing it stays above the fields */}
            {split ? attachments : null}
            {split?.rest.length ? <dl className="mt-4 space-y-2 text-sm">{split.rest.map(cell)}</dl> : null}
            {empty ? (
              <button type="button" onClick={() => setShowEmpty(!showEmpty)} className="inline-flex min-h-11 items-center mt-2 text-sm text-accent-ink hover:underline">
                {showEmpty ? `Hide empty fields (${empty})` : `Show empty fields (${empty})`}
              </button>
            ) : null}
            {hiddenSet.size ? (
              <p className="mt-1 text-sm text-muted">
                <button type="button" onClick={() => setRevealHidden(!revealHidden)} className="inline-flex min-h-11 items-center text-accent-ink hover:underline">
                  {revealHidden ? `Hide the ${hiddenSet.size} you keep hidden` : `${hiddenSet.size} hidden`}
                </button>{" "}
                · <Link href="/settings/my-view" className="underline">My view</Link>
              </p>
            ) : null}
            <h3 className="mt-6 font-semibold">History</h3>
            <ol className="mt-2 space-y-2 text-sm">
              {data.history.length === 0 ? <li className="text-muted">No changes recorded.</li> : null}
              {data.history.map((h) => (
                <li key={h.id} className="rounded-lg border border-line bg-panel px-3 py-2">
                  <span className="text-xs text-muted">
                    {new Date(h.at).toLocaleString()} · {h.actor.kind === "person" ? h.actor.name : agentName(h.actor.name)}
                    {h.actor.kind === "person" ? (h.actor.name === me.name ? " (you)" : " (person)") : ` (bot${h.actor.via && h.actor.via !== h.actor.name ? `, via ${h.actor.via}` : ""})`}
                  </span>
                  {h.column === "cleared" ? (
                    <span className="block">
                      Cleared: {Object.keys((h.old as Record<string, unknown>) ?? {}).map(label).join(", ")}
                    </span>
                  ) : (
                    <span className="block">
                      {label(h.column)}: {show(h.old) ? <s className="text-muted">{show(h.old).slice(0, 120)}</s> : <span className="text-muted">empty</span>} →{" "}
                      {show(h.new).slice(0, 200) || <span className="text-muted">empty</span>}
                    </span>
                  )}
                  {h.outcome === "refused" ? <span className="text-xs text-bad">refused: {REASON[h.reason ?? ""] ?? h.reason}</span> : null}
                </li>
              ))}
            </ol>
          </>
        ) : !error ? (
          <p className="mt-4 text-sm text-muted">Loading…</p>
        ) : null}
      </aside>
      </div>
    </div>
  );
}

/** The header block: business as the title, website as a link, location and industry on one muted line;
 *  each with an Edit that shows on hover (always on touch screens). */
function HeaderField({ k, value, busy, choices, onSave }: { k: string; value: unknown; busy: boolean; choices?: string[]; onSave: (v: unknown) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const v = show(value);
  if (editing)
    return (
      <form
        className="my-1 flex w-full flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await onSave(draft.trim() === "" ? null : draft)) setEditing(false);
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} list={choices ? `hl-${k}` : undefined} aria-label={label(k)} className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 text-base text-ink" />
        {choices ? (
          <datalist id={`hl-${k}`}>
            {choices.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        ) : null}
        <button disabled={busy} className="inline-flex min-h-11 items-center rounded-full bg-accent px-3 text-sm font-semibold text-on-accent disabled:opacity-50">
          Save
        </button>
        <button type="button" onClick={() => setEditing(false)} className="inline-flex min-h-11 items-center text-sm text-muted hover:underline">
          Cancel
        </button>
      </form>
    );
  const edit = (
    <button
      type="button"
      onClick={() => {
        setDraft(v);
        setEditing(true);
      }}
      aria-label={`Edit ${label(k)}`}
      className="inline-flex min-h-11 items-center ml-1 text-sm font-normal text-accent-ink hover:underline sm:hidden sm:group-focus-within:inline sm:group-hover:inline"
    >
      Edit
    </button>
  );
  if (k === "business") return <h2 className="group text-xl font-bold">{v || "…"}{edit}</h2>;
  if (k === "website")
    return (
      <p className="group text-sm">
        {v ? (
          <a href={isUrl(v) ? v : `https://${v}`} target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">
            {v.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </a>
        ) : (
          <span className="text-muted">no website</span>
        )}
        {edit}
      </p>
    );
  return (
    <span className="group">
      {v || <span className="italic">no {label(k).toLowerCase()}</span>}
      {edit}
    </span>
  );
}

/** A draft's text, editable where it is shown: no frame of its own, the box's font and line height, as tall as its text
 *  (it grows as you type), so starting an edit moves nothing. */
function InPlaceText({ value, onChange, label, onPaste, roomy = false }: { value: string; onChange: (v: string) => void; label: string; onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>; roomy?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = "0px";
    t.style.height = `${t.scrollHeight}px`;
  }, [value]);
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.focus({ preventScroll: true });
    t.setSelectionRange(t.value.length, t.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPaste={onPaste}
      aria-label={label}
      rows={1}
      className={`block w-full resize-none appearance-none overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent p-0 text-[length:inherit] leading-[inherit] text-[color:inherit] shadow-none ${roomy ? "min-h-24" : ""}`}
      // the global focus ring (globals.css, unlayered) would draw a frame inside the box: the box's accent border shows the edit
      style={{ outline: "none" }}
    />
  );
}

/** One field: its value (a link, a draft with Copy), and for a person-editable field an Edit that saves it. */
/** The one extra click after a reply or a win. Saved or skipped, the lead's own step is already saved. */
function SendAnswer({ id, channel, amount, onDone }: { id: string; channel: boolean; amount: boolean; onDone: (log: SendLog | null | undefined) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const send = async (ch?: "email" | "whatsapp") => {
    setSaving(true);
    setError("");
    const r = (await fetch(`/api/leads/${id}/send-log`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: ch, amount: amount ? value : undefined }) })
      .then((x) => x.json())
      .catch(() => ({ ok: false, error: "No answer from the server." }))) as { ok: boolean; error?: string; sendLog?: SendLog | null };
    setSaving(false);
    if (!r.ok) return setError(r.error ?? "Not saved.");
    onDone(r.sendLog);
  };
  const btn = "inline-flex min-h-11 items-center rounded-full border border-accent bg-panel px-3 text-sm font-semibold text-accent-ink disabled:opacity-60";
  return (
    <div data-send-answer className="mt-2 rounded-xl border border-line bg-panel p-3 text-sm">
      {amount ? (
        <label className="mb-2 block">
          <span className="text-muted">Amount won (optional)</span>
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="1200" className="mt-1 block min-h-11 w-40 rounded-lg border border-line bg-bg px-3" />
        </label>
      ) : null}
      {channel ? <p className="mb-2 text-muted">Which message did they answer?</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {channel ? (
          <>
            <button type="button" disabled={saving} onClick={() => void send("email")} className={btn}>Email</button>
            <button type="button" disabled={saving} onClick={() => void send("whatsapp")} className={btn}>WhatsApp</button>
          </>
        ) : (
          <button type="button" disabled={saving} onClick={() => void send()} className={btn}>Save amount</button>
        )}
        <button type="button" disabled={saving} onClick={() => onDone(undefined)} className="inline-flex min-h-11 items-center px-2 text-sm text-muted hover:underline">Skip</button>
      </div>
      {error ? <p role="alert" className="mt-2 text-bad">{error}</p> : null}
    </div>
  );
}

function Cell({ k, value, rich, busy, choices, onSave, copyAs }: { k: string; value: unknown; rich?: string; busy: boolean; choices: Choices; onSave: (v: unknown, html?: string | null) => Promise<boolean>; copyAs?: (v: string) => string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const v = shownCell(k, value);
  const editable = !READ_ONLY.has(k);
  // a cell holding a pasted Google Doc edits as that document; every other cell stays a plain text box
  const [html, setHtml] = useState<string | null>(null);
  const [pasteNote, setPasteNote] = useState("");
  const editor = useRef<HTMLDivElement>(null);
  const start = () => {
    setDraft(v);
    setHtml(rich ?? null);
    setPasteNote("");
    setEditing(true);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (html !== null && editor.current) {
      const plain = plainOf(editor.current);
      if (await onSave(plain || null, plain ? editor.current.innerHTML : null)) setEditing(false);
      return;
    }
    if (await onSave(draft.trim() === "" ? null : draft)) setEditing(false);
  };
  const docPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!RICH_FIELDS.has(k)) return;
    const raw = e.clipboardData.getData("text/html");
    if (!isDocsPaste(raw)) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const before = draft.slice(0, e.currentTarget.selectionStart);
    const after = draft.slice(e.currentTarget.selectionEnd);
    void cleanPaste(raw)
      .then((clean) => {
        setHtml(`${textToHtml(before)}${clean}${textToHtml(after)}`);
        setPasteNote(hasPictures(raw) ? PICTURES_NOTE : "");
      })
      .catch(() => setDraft(`${before}${text}${after}`));
  };
  const list = k === "package" ? choices.package : k === "industry" ? choices.industry : k === "location" ? choices.location : null;
  // Every field is the draft email's box. Its label and actions on one line, the value below; Edit turns the value
  // editable in place, Save and Cancel take Copy and Edit's places, and the border turns to the accent. An empty field is one
  // quiet line with Add, and opens the same way.
  const filled = !!v;
  const formId = useId();
  const action = "inline-flex min-h-11 items-center text-sm text-accent-ink hover:underline";
  return (
    <div data-cell={k} data-cell-state={editing ? "editing" : filled ? "filled" : "empty"} className={`rounded-xl border bg-panel px-3 ${editing || filled ? "pb-3" : ""} ${editing ? "border-accent" : filled ? "border-line" : "border-dashed border-line"}`}>
      <dt className="flex min-h-11 items-center justify-between gap-3 text-muted">
        <span className="min-w-0">{label(k)}</span>
        {editing ? (
          <span className="flex shrink-0 gap-3">
            <button form={formId} disabled={busy} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-ink hover:underline disabled:opacity-50">
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="inline-flex min-h-11 items-center text-sm text-muted hover:underline">
              Cancel
            </button>
          </span>
        ) : filled ? (
          <span className="flex shrink-0 gap-3">
            <button
              type="button"
              aria-label={copied ? `${label(k)} copied` : `Copy ${label(k)}`}
              onClick={async () => {
                const final = copyAs ? copyAs(v) : v;
                const formatted = rich ? richWithEnding(rich, v, final) : null;
                setCopied(formatted ? await copyRich(formatted, final) : await copy(final));
                setTimeout(() => setCopied(false), 2000);
              }}
              className={action}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            {editable ? (
              <button type="button" onClick={start} aria-label={`Edit ${label(k)}`} className={action}>
                Edit
              </button>
            ) : null}
          </span>
        ) : editable ? (
          <button type="button" onClick={start} aria-label={`Add ${label(k)}`} className={`${action} shrink-0`}>
            Add
          </button>
        ) : (
          <span className="shrink-0 text-muted">-</span>
        )}
      </dt>
      {editing ? (
        <dd className="break-words whitespace-pre-line">
          <form id={formId} onSubmit={submit}>
            {SELECT[k] ? (
              <InPlaceSelect value={draft} onChange={setDraft} label={label(k)} options={SELECT[k]} />
            ) : k === "result_date" ? (
              <InPlaceInput type="date" value={draft} onChange={setDraft} label={label(k)} />
            ) : LONG.has(k) ? (
              html !== null ? (
                <RichEditor initial={html} label={label(k)} editorRef={editor} onNote={setPasteNote} />
              ) : (
                <InPlaceText value={draft} onChange={setDraft} label={label(k)} onPaste={docPaste} roomy={!filled} />
              )
            ) : (
              <>
                <InPlaceInput value={draft} onChange={setDraft} label={label(k)} list={list ? `dl-${k}` : undefined} />
                {list ? (
                  <datalist id={`dl-${k}`}>
                    {list.map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                ) : null}
              </>
            )}
            {pasteNote ? <p role="status" className="mt-1 text-xs text-muted">{pasteNote}</p> : null}
          </form>
        </dd>
      ) : filled ? (
        <dd className="break-words whitespace-pre-line">
          {rich ? (
            <RichBody html={rich} />
          ) : k === "phone" && telHref(v) ? (
            <a href={telHref(v)!} className="text-accent-ink tabular-nums hover:underline">
              {v}
            </a>
          ) : isUrl(v) ? (
            <a href={v} target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">
              {v}
            </a>
          ) : k === "found_by" ? (
            agentName(v)
          ) : (
            v
          )}
        </dd>
      ) : (
        <dd className="sr-only">Empty</dd>
      )}
    </div>
  );
}

const IN_PLACE = "block min-h-6 w-full appearance-none border-0 bg-transparent p-0 text-[length:inherit] leading-[inherit] text-[color:inherit] shadow-none";

/** A one-line field, edited where its value is shown, with no frame of its own: the box's accent border shows the edit. */
function InPlaceInput({ value, onChange, label, type = "text", list }: { value: string; onChange: (v: string) => void; label: string; type?: string; list?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return <input ref={ref} type={type} value={value} list={list} onChange={(e) => onChange(e.target.value)} aria-label={label} className={IN_PLACE} style={{ outline: "none" }} />;
}

function InPlaceSelect({ value, onChange, label, options }: { value: string; onChange: (v: string) => void; label: string; options: string[] }) {
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <select ref={ref} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="block min-h-6 w-full border-0 bg-panel p-0 text-[length:inherit] text-[color:inherit]" style={{ outline: "none" }}>
      <option value="">(empty)</option>
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}

