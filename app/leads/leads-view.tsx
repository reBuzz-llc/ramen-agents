"use client";
// The Leads board, the team's working board. Board tab: a filterable table (status, borough,
// industry group, score, draft, role, Mine, Corrected by the team) with status chips; Table tab: the same filters over
// every cell as a grid (lead-table.tsx); a row in either opens the drawer, where a
// person edits any cell (saved as that person into the lead's history), takes the next step with one click, takes the
// lead, and copies a draft. Send next tab: the Validator's pick of what to send next, with take, copy and mark sent.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { leadPath } from "@/lib/deep-links";
import { industryGroup } from "@/lib/lead-filters";
import { withAttachments } from "@/lib/attachment-line";
import { telHref } from "@/lib/phone";
import { CONTACT_ROLES, DRAWER_ORDER, EMAIL_STATUSES, emailSteps, LINKEDIN_VIA, READ_ONLY, RESULTS, tone, WHATSAPP_STATUSES, whatsappSteps, type Step } from "@/lib/lead-workflow";
import type { SendNext } from "@/lib/send-next";
import { control, Field } from "../ui";
import { CHIP, Chip } from "./chip";
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
  takenBy: string | null;
  mine: boolean;
  corrected: boolean;
  openFlags: number;
  updatedAt: string;
};
type Me = { userId: string; name: string };
type Choices = { package: string[]; industry: string[]; location: string[] };

type F = { q: string; email: string; whatsapp: string; city: string; industry: string; score: string; draft: string; role: string; mine: boolean; corrected: boolean; flagged: boolean };
const NONE: F = { q: "", email: "", whatsapp: "", city: "", industry: "", score: "", draft: "", role: "", mine: false, corrected: false, flagged: false };
const NOT_SET = "(not set)";

function counts(rows: BoardRow[], key: (r: BoardRow) => string) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function matches(r: BoardRow, f: F) {
  if (f.q) {
    const hay = `${r.business} ${r.website ?? ""} ${r.contactPerson ?? ""} ${r.industry ?? ""} ${r.city ?? ""}`.toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  if (f.email && (r.emailStatus ?? NOT_SET) !== f.email) return false;
  if (f.whatsapp && (r.whatsappStatus ?? NOT_SET) !== f.whatsapp) return false;
  if (f.city && (r.city || NOT_SET) !== f.city) return false;
  if (f.industry && industryGroup(r.industry ?? "") !== f.industry) return false;
  if (f.score === "none" ? r.leadScore !== null : f.score && (r.leadScore ?? -1) < Number(f.score)) return false;
  if (f.draft && r.hasDraft !== (f.draft === "yes")) return false;
  if (f.role && !!r.contactRole !== (f.role === "yes")) return false;
  if (f.mine && !r.mine) return false;
  if (f.corrected && !r.corrected) return false;
  if (f.flagged && !r.openFlags) return false;
  return true;
}

/** A status chip with a small × at its end: pressing it empties that status, and with it the cells
 *  its step set (sent by and at, result and its date), as one history entry by the person. */
function StatusChip({ label: what, status, disabled, onClear }: { label: string; status: string | null; disabled?: boolean; onClear: () => void }) {
  if (!status) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full py-0.5 pr-0.5 pl-2.5 text-xs whitespace-nowrap ${CHIP[tone(status)]}`}>
      {status}
      <button
        type="button"
        disabled={disabled}
        onClick={onClear}
        aria-label={`Clear ${what} (${status})`}
        title={`Clear ${what}`}
        className="inline-flex size-6 items-center justify-center rounded-full hover:bg-ink/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
          <path d="M2 2l6 6M8 2L2 8" />
        </svg>
      </button>
    </span>
  );
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

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => set(!on)}
      className={`inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm ${on ? "border-accent bg-accent-tint font-semibold" : "border-line bg-panel hover:border-accent"}`}
    >
      {on ? <span aria-hidden>✓</span> : null}
      {label}
    </button>
  );
}

export default function LeadsView({
  rows,
  next,
  me,
  tab,
  canImport = false,
  openId = null,
  unavailable = false,
}: {
  rows: TableRow[];
  next: SendNext;
  me: Me;
  tab: "board" | "table" | "send";
  canImport?: boolean;
  openId?: string | null;
  unavailable?: boolean;
}) {
  const [f, setF] = useState<F>(NONE);
  // the open drawer lives in the address, /leads?lead=<id>: a load with it opens that lead
  const [open, setOpen] = useState<string | null>(openId);
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
  // a load that names a lead: its row scrolled into view, the filters as they were
  useEffect(() => {
    if (!openId) return;
    const t = setTimeout(() => document.querySelector(`[data-lead="${openId}"]`)?.scrollIntoView({ block: "center" }), 50);
    return () => clearTimeout(t);
  }, [openId]);
  const shown = useMemo(() => rows.filter((r) => matches(r, f)), [rows, f]);
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
        {canImport ? (
          <Link href="/leads/import" className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-panel px-4 text-sm font-semibold hover:border-accent">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
            </svg>
            Import CSV
          </Link>
        ) : null}
      </div>
      <p className={`mt-1 text-[0.9375rem] text-muted ${narrow}`}>Every business on the board, with where it stands. Open one to see its details, its history and what to do next.</p>
      <nav className={`mt-4 flex gap-1 border-b border-line text-sm ${narrow}`} aria-label="Leads views">
        {(
          [
            ["send", "Send next", next.rows.length],
            ["board", "Board", rows.length],
            ["table", "Table", rows.length],
          ] as const
        ).map(([key, label, n]) => (
          <Link
            key={key}
            href={key === "send" ? "/leads" : `/leads?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-4 ${tab === key ? "border-accent font-semibold" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label} <span className="ml-1 rounded-full bg-panel px-1.5 text-xs tabular-nums">{n}</span>
          </Link>
        ))}
      </nav>
      {tab === "send" ? (
        <SendNextView next={next} me={me} onOpen={setOpen} />
      ) : rows.length === 0 ? (
        <p className={`mt-6 rounded-xl border border-line bg-panel p-6 text-sm text-muted ${narrow}`}>No leads here yet. They arrive when the Notion board is copied over (the backfill).</p>
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
              <Pick label="Score" value={f.score} onChange={on("score")} options={[["85", "85 and up"], ["70", "70 and up"], ["50", "50 and up"], ["none", "no score"]]} />
              <Pick label="Draft email" value={f.draft} onChange={on("draft")} options={[["yes", "has a draft"], ["no", "no draft"]]} />
              <Pick label="Contact role" value={f.role} onChange={on("role")} options={[["yes", "has a role"], ["no", "no role"]]} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Quick filters">
                <Toggle label="Mine" on={f.mine} set={on("mine")} />
                <Toggle label="Corrected by the team" on={f.corrected} set={on("corrected")} />
                <Toggle label="Has flags" on={f.flagged} set={on("flagged")} />
              </div>
              <div className="flex items-center gap-4 text-sm">
                {Object.values(f).some(Boolean) ? (
                  <button type="button" onClick={() => setF(NONE)} className="min-h-11 text-accent-ink hover:underline">
                    Clear filters
                  </button>
                ) : null}
                <span className="text-muted tabular-nums" aria-live="polite">
                  {shown.length} of {rows.length}
                </span>
              </div>
            </div>
          </div>
          {tab === "table" ? (
            <LeadTable rows={shown} onOpen={setOpen} />
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
                    <tr key={r.id} data-lead={r.id} onClick={() => setOpen(r.id)} className="cursor-pointer hover:bg-accent-tint">
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => setOpen(r.id)} className="text-left font-medium hover:underline">
                          {r.business}
                        </button>
                        <span className="block text-xs text-muted">
                          {r.industry ?? ""}
                          {r.takenBy ? ` · taken by ${r.takenBy}` : ""}
                        </span>
                        {r.openFlags ? <span className="mt-0.5 inline-block rounded-full bg-bad/15 px-2 text-xs text-bad">{r.openFlags === 1 ? "1 flag" : `${r.openFlags} flags`}</span> : null}
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
      {open ? <Drawer id={open} me={me} choices={choices} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

type Lead = Record<string, unknown>;
type Change = { id: number; column: string; old: unknown; new: unknown; actor: { kind: string; name: string; via: string | null }; at: string; outcome: string; reason: string | null };
type Flag = { id: string; rule: string; detail: string; status: string; first_seen: string };
type Saved = { ok: boolean; changes?: number[]; error?: string; lead?: Lead; history?: Change[]; refused?: { field: string; reason: string }[] };

async function patch(id: string, fields: Record<string, unknown>): Promise<Saved> {
  try {
    const r = await fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
    return (await r.json()) as Saved;
  } catch {
    return { ok: false, error: "No answer from the server; check the connection and try again." };
  }
}

async function claim(id: string, action: "accept" | "release"): Promise<{ ok: boolean; error?: string }> {
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
  const from = next.source === "validator" ? "the Validator's list" : next.source === "file" ? "the Validator's file on this computer" : "the board (a draft, not sent, best score first)";
  return (
    <div className="mt-4">
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
                    onClick={async () => say(r.id, (await copy(withAttachments(r.draft!, r.attachments))) ? "Draft copied." : "Copy failed: open the lead and select the draft.")}
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

const LABELS: Record<string, string> = {
  business: "Business",
  website: "Website",
  business_email: "Business email",
  email_check: "Email check",
  location: "Location",
  industry: "Industry",
  size: "Company size",
  contact_person: "Contact person",
  contact_role: "Contact role",
  founder_linkedin: "Founder LinkedIn",
  linkedin_via: "LinkedIn found via",
  whatsapp: "WhatsApp",
  map_link: "Map",
  pain_point: "Pain point",
  package: "How can I help",
  evidence: "Evidence",
  listing_evidence: "Google listing",
  source_pages: "Source pages",
  tools_on_site: "Tools on site",
  site_health: "Site health",
  lead_score: "Lead score",
  draft_email: "Draft email",
  draft_whatsapp: "Draft WhatsApp message",
  email_status: "Email status",
  whatsapp_status: "WhatsApp status",
  result: "Result",
  result_date: "Result date",
  sent_by: "Sent by",
  sent_at: "Sent at",
  found_by: "Found by",
  phone: "Phone",
  notes: "Notes",
  notion_uid: "Notion ID",
  created_at: "Created",
};
const label = (k: string) => LABELS[k] ?? k;
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "" : Array.isArray(v) ? v.join(", ") : String(v));
const isUrl = (v: string) => /^https?:\/\//.test(v);
const LONG = new Set(["pain_point", "draft_email", "draft_whatsapp", "source_pages", "site_health", "notes"]);
const SELECT: Record<string, string[]> = { contact_role: CONTACT_ROLES, linkedin_via: LINKEDIN_VIA, email_status: EMAIL_STATUSES, whatsapp_status: WHATSAPP_STATUSES, result: RESULTS };
const REASON: Record<string, string> = { person_wins: "a person changed it last", human_only: "the team's field", filled: "already filled" };

/** Copy link: the lead's canonical address to the clipboard, "Copied" for two seconds. Where the
 *  clipboard is refused, the address shows selected in a field, ready for ⌘C. */
function CopyLink({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const url = typeof window === "undefined" ? leadPath(id) : `${window.location.origin}${leadPath(id)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("manual");
    }
  };
  if (state === "manual")
    return (
      <input
        readOnly
        value={url}
        aria-label="Link to this lead"
        ref={(el) => {
          // shown because the clipboard refused: selected, ready to copy by hand
          el?.focus();
          el?.select();
        }}
        onBlur={() => setState("idle")}
        className="h-9 w-48 rounded-lg border border-line bg-panel px-2 text-xs sm:w-64"
      />
    );
  return (
    <button type="button" onClick={() => void copy()} title="Copy link" aria-label={state === "copied" ? "Link copied" : "Copy link to this lead"} className="group/link inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted hover:text-ink">
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
      <span className={state === "copied" ? "text-good" : "hidden group-hover/link:inline"}>{state === "copied" ? "Copied" : "Copy link"}</span>
    </button>
  );
}

export const GUIDE_HINT_KEY = "peek.guide-hint-seen";

function Drawer({ id, me, choices, onClose }: { id: string; me: Me; choices: Choices; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<{ lead: Lead; history: Change[]; flags?: Flag[]; attachments?: Attached[] } | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [taken, setTaken] = useState(false);
  const [done, setDone] = useState<{ key: string; label: string }[]>([]);
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
    let live = true;
    fetch(`/api/leads/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setData(d))
      .catch(() => live && setError("Could not load this lead. Try again."));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      live = false;
      window.removeEventListener("keydown", esc);
    };
  }, [id, onClose]);
  const save = async (fields: Record<string, unknown>, done: string): Promise<boolean> => {
    setBusy(true);
    setMsg("");
    const r = await patch(id, fields);
    setBusy(false);
    if (!r.ok || !r.lead) {
      setMsg(r.error ?? "Not saved.");
      return false;
    }
    setData({ lead: r.lead, history: r.history ?? data?.history ?? [], flags: data?.flags, attachments: data?.attachments });
    setMsg(r.refused?.length ? `Not saved: ${r.refused.map((x) => `${label(x.field)} (${REASON[x.reason] ?? x.reason})`).join(", ")}` : done);
    router.refresh();
    return true;
  };
  const step = async (s: Step) => {
    if (busy || done.some((d) => d.key === s.key)) return;
    if (await save(s.fields, `${s.label}: saved.`)) setDone((d) => [...d, { key: s.key, label: s.label }]);
  };
  // The × on a status chip: empties it and the cells its step set; the step buttons start over.
  const clear = async (field: "email_status" | "whatsapp_status" | "result", what: string) => {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/leads/${id}/clear`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field }) });
      const r = (await res.json()) as { ok: boolean; error?: string; lead?: Lead; history?: Change[]; cleared?: string[] };
      if (!r.ok || !r.lead) return setMsg(r.error ?? "Not cleared.");
      setData({ lead: r.lead, history: r.history ?? data?.history ?? [], flags: data?.flags, attachments: data?.attachments });
      setDone([]);
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
    setBusy(false);
    if (!r.ok) return setMsg(r.error ?? "That failed.");
    setTaken(action === "accept");
    setMsg(action === "accept" ? "Taken: it is yours." : "Given back.");
    router.refresh();
  };
  const lead = data?.lead;
  const steps: Step[] = lead ? [...emailSteps(lead), ...whatsappSteps(lead)] : [];
  const keys = DRAWER_ORDER.filter((k) => showEmpty || show(lead?.[k]));
  const empty = lead ? DRAWER_ORDER.filter((k) => !show(lead[k])).length : 0;
  // The next step in the brand orange, the other next steps as orange outlines, a losing one as a red outline (never a
  // prominent destructive button); steps already taken here are muted with a check and cannot be pressed again.
  const stepClass = (t: Step["tone"], first: boolean) =>
    t === "bad" ? "border border-bad/50 bg-panel text-bad hover:bg-bad/10" : first ? "bg-accent text-on-accent hover:bg-accent-hover" : "border border-accent bg-panel text-accent-ink hover:bg-accent-tint";
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-ink/30" />
      <aside role="dialog" aria-modal="true" aria-label={String(lead?.business ?? "Lead")} className="relative h-full w-full max-w-xl overflow-y-auto bg-bg p-5 shadow-xl">
        {hint ? (
          <p role="note" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-accent bg-accent-tint px-3 py-2 text-sm">
            <span>
              First lead? How to send it by hand and record it:{" "}
              <Link href="/guide#send" className="font-medium text-accent-ink underline">
                the guide
              </Link>
              .
            </span>
            <button type="button" aria-label="Hide this hint" onClick={() => setHint(false)} className="min-h-6 shrink-0 px-1 text-muted hover:text-ink">
              ×
            </button>
          </p>
        ) : null}
        <div className="flex items-start justify-between gap-3">
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
                <p className="mt-2 flex flex-wrap gap-1">
                  <StatusChip label="email status" status={show(lead.email_status) || null} disabled={busy} onClear={() => void clear("email_status", "Email status")} />
                  <StatusChip label="result" status={show(lead.result) || null} disabled={busy} onClear={() => void clear("result", "Result")} />
                  <StatusChip label="WhatsApp status" status={show(lead.whatsapp_status) || null} disabled={busy} onClear={() => void clear("whatsapp_status", "WhatsApp status")} />
                </p>
              </>
            ) : (
              <h2 className="text-xl font-bold">…</h2>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <CopyLink id={id} />
            <button type="button" onClick={onClose} className="min-h-11 px-1 text-sm text-muted hover:text-ink">
              Close
            </button>
          </div>
        </div>
        {error ? <p className="mt-4 text-sm text-bad">{error}</p> : null}
        {lead ? (
          <>
            {(data.flags ?? [])
              .filter((x) => x.status === "open")
              .map((x) => (
                <p key={x.id} role="note" className="mt-3 rounded-lg border-l-4 border-bad bg-bad/10 px-3 py-2 text-sm">
                  <span className="font-semibold text-bad">{x.rule}</span> {x.detail}
                  <span className="block text-xs text-muted">flagged {new Date(x.first_seen).toLocaleDateString()}</span>
                </p>
              ))}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {done.map((s) => (
                <span key={`done-${s.key}`} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-panel px-3 text-sm text-muted">
                  <span aria-hidden>✓</span> {s.label}
                </span>
              ))}
              {steps.map((s, i) => (
                <button key={s.key} type="button" disabled={busy} onClick={() => void step(s)} className={`min-h-11 rounded-full px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${stepClass(s.tone, i === 0)}`}>
                  {s.label}
                </button>
              ))}
              <button type="button" disabled={busy} onClick={() => take(taken ? "release" : "accept")} className="inline-flex min-h-11 items-center text-sm text-accent-ink hover:underline">
                {taken ? "Give back" : "Take it"}
              </button>
            </div>
            {msg ? (
              <p role="status" className="mt-2 text-sm">
                {msg}
              </p>
            ) : null}
            <Attachments leadId={id} initial={data.attachments ?? []} onChange={(a) => setData((d) => (d ? { ...d, attachments: a } : d))} />
            <dl className="mt-4 space-y-1.5 text-sm">
              {keys.map((k) => (
                <Cell
                  key={k}
                  k={k}
                  value={lead[k]}
                  busy={busy}
                  choices={choices}
                  copyAs={k === "draft_email" ? (v) => withAttachments(v, (data.attachments ?? []).map((a) => a.name)) : undefined}
                  onSave={(v) => save({ [k]: v }, `${label(k)}: saved.`)}
                />
              ))}
            </dl>
            {empty ? (
              <button type="button" onClick={() => setShowEmpty(!showEmpty)} className="inline-flex min-h-11 items-center mt-2 text-sm text-accent-ink hover:underline">
                {showEmpty ? "Hide empty fields" : `Show empty fields (${empty})`}
              </button>
            ) : null}
            <h3 className="mt-6 font-semibold">History</h3>
            <ol className="mt-2 space-y-2 text-sm">
              {data.history.length === 0 ? <li className="text-muted">No changes recorded.</li> : null}
              {data.history.map((h) => (
                <li key={h.id} className="rounded-lg border border-line bg-panel px-3 py-2">
                  <span className="text-xs text-muted">
                    {new Date(h.at).toLocaleString()} · {h.actor.name}
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

/** One field: its value (a link, a draft with Copy), and for a person-editable field an Edit that saves it. */
function Cell({ k, value, busy, choices, onSave, copyAs }: { k: string; value: unknown; busy: boolean; choices: Choices; onSave: (v: unknown) => Promise<boolean>; copyAs?: (v: string) => string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const v = show(value);
  const editable = !READ_ONLY.has(k);
  const start = () => {
    setDraft(v);
    setEditing(true);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await onSave(draft.trim() === "" ? null : draft)) setEditing(false);
  };
  const list = k === "package" ? choices.package : k === "industry" ? choices.industry : k === "location" ? choices.location : null;
  const input = "h-11 w-full rounded-xl border border-line bg-panel px-3 text-base";
  const boxed = (k === "draft_email" || k === "draft_whatsapp") && !!v && !editing;
  return (
    <div className={boxed ? "rounded-xl border border-line bg-panel p-3" : "grid grid-cols-[9rem_1fr] gap-x-3"}>
      <dt className="text-muted">
        {label(k)}
        {boxed ? (
          <span className="float-right flex gap-3">
            <button
              type="button"
              onClick={async () => {
                setCopied(await copy(copyAs ? copyAs(v) : v));
                setTimeout(() => setCopied(false), 2000);
              }}
              className="inline-flex min-h-11 items-center text-sm text-accent-ink hover:underline"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" onClick={start} className="inline-flex min-h-11 items-center text-sm text-accent-ink hover:underline">
              Edit
            </button>
          </span>
        ) : null}
      </dt>
      <dd className={`break-words whitespace-pre-line ${boxed ? "mt-2" : ""}`}>
        {editing ? (
          <form onSubmit={submit} className="space-y-1">
            {SELECT[k] ? (
              <select value={draft} onChange={(e) => setDraft(e.target.value)} className={input} aria-label={label(k)}>
                <option value="">(empty)</option>
                {SELECT[k].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : k === "result_date" ? (
              <input type="date" value={draft} onChange={(e) => setDraft(e.target.value)} className={input} aria-label={label(k)} />
            ) : LONG.has(k) ? (
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={k.startsWith("draft") ? 10 : 4} className={input} aria-label={label(k)} />
            ) : (
              <>
                <input value={draft} onChange={(e) => setDraft(e.target.value)} list={list ? `dl-${k}` : undefined} className={input} aria-label={label(k)} />
                {list ? (
                  <datalist id={`dl-${k}`}>
                    {list.map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                ) : null}
              </>
            )}
            <span className="flex gap-3">
              <button disabled={busy} className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-on-accent disabled:opacity-50">
                Save
              </button>
              <button type="button" onClick={() => setEditing(false)} className="inline-flex min-h-11 items-center text-sm text-muted hover:underline">
                Cancel
              </button>
            </span>
          </form>
        ) : (
          <>
            {v ? (
              k === "phone" && telHref(v) ? (
                <a href={telHref(v)!} className="text-accent-ink tabular-nums hover:underline">
                  {v}
                </a>
              ) : isUrl(v) ? (
                <a href={v} target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">
                  {v}
                </a>
              ) : (
                v
              )
            ) : (
              <span className="text-muted">-</span>
            )}
            {editable && !boxed ? (
              <button type="button" onClick={start} className="inline-flex min-h-11 items-center ml-2 text-sm text-accent-ink hover:underline" aria-label={`Edit ${label(k)}`}>
                Edit
              </button>
            ) : null}
          </>
        )}
      </dd>
    </div>
  );
}
