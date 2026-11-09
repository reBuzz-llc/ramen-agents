"use client";
// Settings → My view's editor: the drawer's fields in the person's order, each with up and down
// (and drag on a computer) and a Hide box; "Show empty fields by default"; the Table tab's column order copied in; Reset.
// Every change is saved at once to the person (POST /api/view-prefs), so it follows them to any browser.
import { useState } from "react";
import { COLUMNS, STORE } from "@/app/leads/lead-table";
import { drawerOrder, fieldLabel, orderFromTable, type ViewPrefs } from "@/lib/view-prefs";
import { helper, sectionTitle } from "@/lib/ui-classes";

const small = "inline-flex size-11 items-center justify-center rounded-full border border-line bg-panel text-sm hover:border-accent disabled:opacity-40";
const pill = "inline-flex min-h-11 items-center rounded-full border border-line bg-panel px-4 text-sm font-semibold hover:border-accent disabled:opacity-50";

export default function MyViewEditor({ initial }: { initial: ViewPrefs }) {
  const [view, setView] = useState(initial);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const order = drawerOrder(view);
  const hidden = new Set(view.hidden_fields);

  const save = async (patch: Partial<ViewPrefs> | { reset: true }, done: string) => {
    const before = view;
    if (!("reset" in patch)) setView({ ...view, ...patch });
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/view-prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const r = (await res.json()) as { ok: boolean; view?: ViewPrefs; error?: string };
      if (!r.ok || !r.view) throw new Error(r.error ?? "not saved");
      setView(r.view);
      setMsg(done);
    } catch (e) {
      setView(before);
      setMsg(`Not saved: ${e instanceof Error ? e.message : "no answer from the server"}.`);
    } finally {
      setBusy(false);
    }
  };
  const move = (k: string, to: number) => {
    const next = order.filter((x) => x !== k);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, k);
    void save({ field_order: next }, `${fieldLabel(k)} moved.`);
  };
  const fromTable = () => {
    let keys = COLUMNS.map((c) => c.key);
    try {
      const raw = localStorage.getItem(STORE);
      const saved = raw ? (JSON.parse(raw) as { order?: string[] }) : null;
      if (saved?.order?.length) keys = [...new Set([...saved.order, ...keys])];
    } catch {
      /* no saved arrangement in this browser: the Table's default order */
    }
    void save({ field_order: orderFromTable(keys) }, "The Table tab's column order is now your drawer's order.");
  };

  return (
    <div className="mt-6 space-y-8">
      <section>
        <h2 className={sectionTitle}>Empty fields</h2>
        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line bg-panel px-4 py-2 text-[0.9375rem]">
          <input type="checkbox" role="switch" checked={view.show_empty} disabled={busy} onChange={(e) => void save({ show_empty: e.target.checked }, e.target.checked ? "Empty fields are shown." : "Empty fields are hidden.")} className="size-5 accent-[var(--color-accent)]" />
          Show empty fields by default
        </label>
        <p className={helper}>Shown, you see at once what a lead still lacks. The drawer&apos;s Hide/Show empty fields button changes this too.</p>
      </section>
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={sectionTitle}>The drawer&apos;s fields, in order</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={fromTable} className={pill}>
              Use my Table column order
            </button>
            <button type="button" disabled={busy} onClick={() => void save({ reset: true }, "Back to the default view.")} className={pill}>
              Reset to default
            </button>
          </div>
        </div>
        <p className={helper}>Business, website, location and industry stay at the top of the drawer. A hidden field sits behind an &ldquo;n hidden&rdquo; line in the drawer.</p>
        <ol className="mt-3 divide-y divide-line rounded-xl border border-line bg-panel" aria-label="Drawer fields">
          {order.map((k, i) => (
            <li
              key={k}
              draggable={!busy}
              onDragStart={() => setDragging(k)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragging && dragging !== k) move(dragging, i);
                setDragging(null);
              }}
              className={`flex items-center gap-2 px-3 py-1 ${dragging === k ? "opacity-50" : ""}`}
            >
              <span aria-hidden className="cursor-grab text-muted select-none">⋮⋮</span>
              <span className="w-6 text-right text-xs text-muted tabular-nums">{i + 1}</span>
              <span className={`flex-1 text-[0.9375rem] ${hidden.has(k) ? "text-muted line-through" : ""}`}>{fieldLabel(k)}</span>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hidden.has(k)}
                  disabled={busy}
                  onChange={(e) => void save({ hidden_fields: e.target.checked ? [...view.hidden_fields, k] : view.hidden_fields.filter((x) => x !== k) }, `${fieldLabel(k)} ${e.target.checked ? "hidden" : "shown"}.`)}
                  className="size-5 accent-[var(--color-accent)]"
                />
                Hide
              </label>
              <button type="button" disabled={busy || i === 0} onClick={() => move(k, i - 1)} aria-label={`Move ${fieldLabel(k)} up`} className={small}>
                ↑
              </button>
              <button type="button" disabled={busy || i === order.length - 1} onClick={() => move(k, i + 1)} aria-label={`Move ${fieldLabel(k)} down`} className={small}>
                ↓
              </button>
            </li>
          ))}
        </ol>
      </section>
      <p role="status" aria-live="polite" className="min-h-6 text-sm text-muted">
        {msg}
      </p>
    </div>
  );
}
