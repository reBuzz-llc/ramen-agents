"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { control, Field } from "@/app/ui";
import { NO_TAKEN_FILTERS, TAKEN_FILTER_KEYS, takenMatches, takenOptions, type TakenFilterKey, type TakenFilters, type TakenOption } from "@/lib/taken-filters";
import { agentName } from "@/lib/agent-names";
import type { TakenChange, TakenItem, TakenSummary } from "@/lib/taken-view";
import type { ViewPrefs } from "@/lib/view-prefs";

// The board's own side panel, loaded the first time a lead is opened here, so the page itself stays light.
const loadPanel = () => import("@/app/leads/leads-view");
const LeadPanel = dynamic(() => loadPanel().then((m) => m.LeadPanel), {
  ssr: false,
  loading: () => <p role="status" className="fixed inset-x-4 top-20 z-40 mx-auto max-w-xs rounded-xl border border-line bg-panel px-4 py-3 text-center text-sm shadow-lg">Opening the lead…</p>,
});

function Pick({ label, value, options, onChange }: { label: string; value: string; options: TakenOption[]; onChange: (v: string) => void }) {
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

/** The list on the left, the chosen lead's changes on the right; on a phone the list, and a lead
 *  opens its changes full screen with a way back. Up and down arrows move through the list. Filters over the
 *  list, and Open lead shows the board's side panel on this page. Both are kept in the address. */
export default function TakenView({ items, summary, title, holder, me, view, openId, filters }: { items: TakenItem[]; summary: TakenSummary; title: string; holder: string; me: { userId: string; name: string }; view: ViewPrefs | null; openId: string | null; filters: TakenFilters }) {
  const [chosen, setChosen] = useState<string | null>(openId);
  const [agents, setAgents] = useState(false);
  const [f, setF] = useState<TakenFilters>(filters);
  const [panel, setPanel] = useState<string | null>(openId);
  // the arrows walk the list as filtered when the lead was opened
  const [trail, setTrail] = useState<string[] | null>(null);
  const closePanel = useCallback(() => {
    setPanel(null);
    setTrail(null);
  }, []);
  const stepPanel = useCallback((id: string) => {
    setPanel(id);
    setChosen(id);
  }, []);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const toggleAgents = setAgents;
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      for (const k of TAKEN_FILTER_KEYS) {
        if (f[k]) u.searchParams.set(k, f[k]);
        else u.searchParams.delete(k);
      }
      if (panel) u.searchParams.set("lead", panel);
      else u.searchParams.delete("lead");
      if (u.href !== window.location.href) window.history.replaceState(window.history.state, "", u);
    } catch {
      /* an address the browser will not rewrite: the filters and the panel still work */
    }
  }, [f, panel]);
  const shown = useMemo(() => items.filter((i) => takenMatches(i, f)), [items, f]);
  const options = useMemo(() => takenOptions(items, f), [items, f]);
  const filtering = TAKEN_FILTER_KEYS.some((k) => f[k]);
  const picksOn = TAKEN_FILTER_KEYS.filter((k) => k !== "q" && f[k]).length;
  // on a phone the dropdowns fold behind one button, so the leads stay near the top
  const [unfolded, setUnfolded] = useState(() => TAKEN_FILTER_KEYS.some((k) => k !== "q" && filters[k]));
  const set = (k: TakenFilterKey) => (v: string) => setF((was) => ({ ...was, [k]: v }));
  // a lead the filters have hidden is no longer the chosen one
  const picked = shown.some((i) => i.id === chosen) ? chosen : null;
  const setPicked = setChosen;
  const current = shown.find((i) => i.id === picked) ?? shown[0] ?? null;
  const held = shown.filter((i) => !i.sent);
  const sent = shown.filter((i) => i.sent);
  const move = (e: React.KeyboardEvent, id: string) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const order = [...held, ...sent];
    const at = order.findIndex((i) => i.id === id) + (e.key === "ArrowDown" ? 1 : -1);
    const next = order[Math.max(0, Math.min(order.length - 1, at))];
    setPicked(next.id);
    buttons.current.get(next.id)?.focus();
  };
  const row = (i: TakenItem) => {
    const people = i.changes.filter((c) => c.person);
    const other = people.some((c) => c.other);
    const on = current?.id === i.id;
    return (
      <li key={i.id}>
        <button
          type="button"
          ref={(el) => {
            if (el) buttons.current.set(i.id, el);
            else buttons.current.delete(i.id);
          }}
          onClick={() => setPicked(i.id)}
          onKeyDown={(e) => move(e, i.id)}
          aria-current={on && picked ? "true" : undefined}
          className={`flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left ${on ? `${picked ? "bg-accent-tint" : "hover:bg-bg lg:bg-accent-tint"} lg:shadow-[inset_3px_0_0_var(--color-accent)]` : "hover:bg-bg"} ${i.sent ? "text-muted" : ""}`}
        >
          <span className="min-w-0 flex-1">
            <span className={`block truncate font-medium ${i.sent ? "" : "text-ink"}`}>{i.business}</span>
            <span className="block truncate text-xs text-muted">{[i.where, i.kind, `${i.sent ? "sent" : "taken"} ${i.when}`].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted" title={other ? "someone other than the holder changed it" : undefined}>
            {people.length ? `${people.length} change${people.length === 1 ? "" : "s"}` : "–"}
            {other ? <span aria-label="changed by someone else" className="ml-1 inline-block h-2 w-2 rounded-full bg-accent align-middle" /> : null}
          </span>
        </button>
      </li>
    );
  };
  return (
    <div data-wide className="mx-auto max-w-[90rem]">
      <Link href="/week" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent-ink hover:underline">
        ← This week
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">{title}</h1>
      <p data-taken-summary className="mt-1 text-sm text-muted">
        {summary.held} held · {summary.sent} sent this week · {summary.changedToday} changed today · {summary.bySomeoneElse} changed by someone else
        <span className="ml-1 inline-block h-2 w-2 rounded-full bg-accent align-middle" aria-hidden />
      </p>
      {items.length ? (
        <div data-taken-filters className={`mt-4 ${picked ? "hidden lg:block" : ""}`}>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Field label="Search" className="col-span-2 min-w-0 md:col-span-1">
              <input type="search" value={f.q} onChange={(e) => set("q")(e.target.value)} placeholder="Business, place, industry" className={`${control} ${f.q ? "border-accent" : ""}`} />
            </Field>
            <button type="button" aria-expanded={unfolded} onClick={() => setUnfolded(!unfolded)} className={`col-span-2 inline-flex min-h-11 items-center justify-center rounded-xl border bg-panel px-3 text-sm font-medium md:hidden ${picksOn ? "border-accent" : "border-line"}`}>
              Filters{picksOn ? ` (${picksOn})` : ""}
            </button>
            <div className={unfolded ? "contents" : "hidden md:contents"}>
              <Pick label="Show" value={f.show} options={options.show} onChange={set("show")} />
              <Pick label="Channel" value={f.channel} options={options.channel} onChange={set("channel")} />
              <Pick label="Place" value={f.place} options={options.place} onChange={set("place")} />
              <Pick label="Industry" value={f.industry} options={options.industry} onChange={set("industry")} />
              <Pick label="Changes" value={f.changes} options={options.changes} onChange={set("changes")} />
            </div>
          </div>
          {filtering ? (
            <p role="status" className="mt-2 flex items-center gap-3 text-sm text-muted">
              {shown.length} of {items.length} leads
              <button type="button" onClick={() => setF(NO_TAKEN_FILTERS)} className="inline-flex min-h-11 items-center font-medium text-accent-ink hover:underline">
                Clear filters
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
      {items.length && !shown.length ? (
        <p className="mt-4 rounded-lg bg-panel p-3 text-sm text-muted">No leads match these filters.</p>
      ) : items.length ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(18rem,26rem)_1fr] lg:items-start">
          <nav aria-label="Leads" className={`overflow-hidden rounded-xl border border-line bg-panel ${picked ? "hidden lg:block" : ""}`}>
            {held.length ? <ul data-taken-list className="divide-y divide-line">{held.map(row)}</ul> : filtering ? null : <p className="p-3 text-sm text-muted">Nothing held right now.</p>}
            {sent.length ? (
              <>
                <p className={`${held.length || !filtering ? "border-t border-line " : ""}bg-bg px-3 py-1.5 text-xs font-semibold text-muted`}>Sent this week ({sent.length})</p>
                <ul className="divide-y divide-line">{sent.map(row)}</ul>
              </>
            ) : null}
          </nav>
          {current ? (
            <section aria-label={`Changes on ${current.business}`} className={`rounded-xl border border-line bg-panel p-4 lg:sticky lg:top-20 ${picked ? "" : "hidden lg:block"}`}>
              <button type="button" onClick={() => setPicked(null)} className="mb-2 inline-flex min-h-11 items-center text-sm font-medium text-accent-ink lg:hidden">
                ← All leads
              </button>
              <Details item={current} agents={agents} onAgents={toggleAgents} holder={holder} onOpen={() => {
                  setTrail(shown.map((i) => i.id));
                  setPanel(current.id);
                }} />
            </section>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 rounded-lg bg-panel p-3 text-sm text-muted">Nothing taken right now, and nothing sent this week.</p>
      )}
      {panel ? <LeadPanel id={panel} me={me} view={view} onClose={closePanel} order={trail ?? shown.map((i) => i.id)} onStep={stepPanel} /> : null}
    </div>
  );
}

function Details({ item, agents, onAgents, holder, onOpen }: { item: TakenItem; agents: boolean; onAgents: (on: boolean) => void; holder: string; onOpen: () => void }) {
  const shown = item.changes.filter((c) => agents || c.person);
  const hidden = item.changes.length - shown.length;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-semibold text-ink">{item.business}</h2>
          <p className="text-xs text-muted">{[item.where, item.kind, `${item.sent ? "sent" : "taken"} ${item.when}`].filter(Boolean).join(" · ")}</p>
        </div>
        <button type="button" onClick={onOpen} onPointerEnter={() => void loadPanel()} onFocus={() => void loadPanel()} className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover">
          Open lead
        </button>
      </div>
      <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={agents} onChange={(e) => onAgents(e.target.checked)} />
        Show the agents&apos; changes too
      </label>
      {shown.length ? (
        <ol data-taken-changes className="mt-1 divide-y divide-line">
          {shown.map((c) => (
            <ChangeRow key={c.id} c={c} holder={holder} />
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-sm text-muted">
          No changes by a person yet.
          {hidden ? (
            <button type="button" onClick={() => onAgents(true)} className="ml-1 text-accent-ink hover:underline">
              Show the agents&apos; {hidden}
            </button>
          ) : null}
        </p>
      )}
    </>
  );
}

function ChangeRow({ c, holder }: { c: TakenChange; holder: string }) {
  const empty = <span className="italic text-muted">empty</span>;
  return (
    <li className={`py-2 text-sm ${c.person ? "" : "text-muted"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium text-ink">{c.field}</span>
        <span className="text-xs text-muted tabular-nums">
          <span className={c.other ? "font-semibold text-ink" : ""}>{c.person ? c.who : `${agentName(c.who)} (agent)`}</span>
          {c.other ? (
            <span title={`not ${holder}, who holds this lead`} className="ml-1 inline-block h-2 w-2 rounded-full bg-accent align-middle">
              <span className="sr-only">, not the holder</span>
            </span>
          ) : null}
          {" · "}
          {c.when}
        </span>
      </div>
      {c.long ? (
        <div className="mt-1 space-y-1">
          <p className="whitespace-pre-wrap break-words rounded-lg bg-bg p-2 text-muted">
            <span className="font-semibold">Before: </span>
            {c.before || empty}
          </p>
          <p className="whitespace-pre-wrap break-words rounded-lg bg-bg p-2">
            <span className="font-semibold">After: </span>
            {c.after || empty}
          </p>
        </div>
      ) : (
        <p className="mt-0.5 break-words">
          <span className="text-muted">{c.before || empty}</span> <span aria-label="changed to">→</span> {c.after || empty}
        </p>
      )}
    </li>
  );
}
