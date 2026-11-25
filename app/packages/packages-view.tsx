"use client";
// The Packages page (moved off the Asset page): the packages (name, price and timeline, the offer in a
// line, who buys it, what they get, draft or published), a bot's handover, and Publish. Everyone reads it as a client sees
// it. The owner and managers edit one package at a time, in place -- its own Edit button turns
// only that card into a form with Save and Cancel; opening another with unsaved changes asks "Save or discard"; a dot marks
// unsaved changes; Esc cancels; a save sends only the changed fields of that one package (PUT /api/assets/package/<id>).
import { agentName } from "@/lib/agent-names";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Package, PackageStatus } from "@/lib/assets";
import { btnOutline, btnPrimary, btnText, control, fieldLabel, helper, pageLead, pageTitle, sectionTitle } from "@/lib/ui-classes";
import { Updated, day, newKey } from "../asset/list-tools";

type PackageDraft = { key: string; id?: string; name: string; price: string; offer: string; buyer: string; deliverables: string; status: PackageStatus; email: string; why: string; sources: string };

const toDraft = (p: Package): PackageDraft => ({
  key: p.id,
  id: p.id,
  name: p.name,
  price: p.price,
  offer: p.offer,
  buyer: p.buyer,
  deliverables: p.deliverables.join("\n"),
  status: p.status,
  email: p.email,
  why: p.why,
  sources: p.sources.join("\n"),
});
const blank = (): PackageDraft => ({ key: newKey(), name: "", price: "", offer: "", buyer: "", deliverables: "", status: "draft", email: "", why: "", sources: "" });

/** The rest of a package, closed by default: the ready-to-send email (the Outreach Writer's base), and, unless the
 *  handover box shows them, why this price and the pages it rests on. */
function More({ p }: { p: Package }) {
  const shownAbove = !!p.handedOverBy && p.status === "draft";
  const why = shownAbove ? "" : p.why.trim();
  const sources = shownAbove ? [] : p.sources;
  if (!p.email && !why && !sources.length) return null;
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-accent-ink">{p.email ? "Ready-to-send email" : "Why this price"}{p.email && (why || sources.length) ? ", why and sources" : ""}</summary>
      {p.email ? <p className="mt-2 rounded-xl bg-bg p-3 whitespace-pre-wrap">{p.email}</p> : null}
      {why ? <p className="mt-2 text-muted">Why: {why}</p> : null}
      {sources.length ? (
        <p className="mt-1 break-words text-muted">
          Sources:{" "}
          {sources.map((u, i) => (
            <span key={u}>
              {i ? ", " : ""}
              <a href={u} target="_blank" rel="noreferrer" className="underline">
                {host(u)}
              </a>
            </span>
          ))}
        </p>
      ) : null}
    </details>
  );
}

function StatusChip({ status }: { status: PackageStatus }) {
  return status === "published" ? (
    <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-on-accent">Published</span>
  ) : (
    <span className="rounded-full border border-line px-2 py-0.5 text-xs font-medium text-muted">Draft</span>
  );
}

/** A bot's handover on a draft: who and when, its reasons, the pages it read. */
function Handover({ p }: { p: Package }) {
  if (!p.handedOverBy || !p.handedOverAt) return null;
  const why = p.why.trim();
  return (
    <div className="mt-auto pt-3">
      <div className="rounded-xl bg-bg px-3 py-2 text-xs text-muted">
        {p.status === "draft" ? (
          <p className="font-medium text-ink">
            Handed over by {agentName(p.handedOverBy)}, {day(p.handedOverAt)}. Check the price, then publish it.
          </p>
        ) : (
          <p>
            First handed over by {agentName(p.handedOverBy)}, {day(p.handedOverAt)}.
          </p>
        )}
        {p.status === "draft" && why ? <p className="mt-1">Why: {why}</p> : null}
        {p.status === "draft" && p.reviewedBy && p.reviewedAt ? (
          <p data-review={p.reviewVerdict ?? ""} className={`mt-1 ${p.reviewVerdict === "revise" ? "text-bad" : "text-ink"}`}>
            Reviewed by {agentName(p.reviewedBy)}, {day(p.reviewedAt)}: <span className="font-semibold">{p.reviewVerdict === "approve" ? "approve" : "revise"}</span>
            {p.reviewNote ? <span> · {p.reviewNote}</span> : null}
          </p>
        ) : null}
        {p.status === "draft" && p.sources.length ? (
          <p className="mt-1 break-words">
            Read:{" "}
            {p.sources.map((u, i) => (
              <span key={u}>
                {i ? ", " : ""}
                <a href={u} target="_blank" rel="noreferrer" className="underline">
                  {host(u)}
                </a>
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

async function publish(ids: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/api/assets/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    return await r.json();
  } catch {
    return { ok: false, error: "No answer from the server." };
  }
}

/** "Publish all drafts" (the owner): a confirm that lists each draft's name and price. A draft a
 *  bot handed over is left out until the owner ticks it; the person-made drafts start ticked. */
function PublishAll({ drafts, onDone }: { drafts: Package[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = () => {
    setError("");
    setPicked(new Set(drafts.filter((d) => !d.handedOverBy).map((d) => d.id)));
    setOpen(true);
  };
  const go = async () => {
    setBusy(true);
    const r = await publish([...picked]);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Not published.");
    setOpen(false);
    onDone();
  };
  if (!open)
    return (
      <button type="button" className={btnOutline} onClick={start}>
        Publish all drafts
      </button>
    );
  return (
    <div role="dialog" aria-labelledby="publish-all-title" className="mt-4 w-full rounded-2xl border border-accent bg-accent-tint p-4">
      <h3 id="publish-all-title" className="font-semibold">
        Publish these drafts?
      </h3>
      <p className={helper}>Published packages are offered: the {agentName("Outreach Writer")} and the price check read them. A draft a bot handed over is included only when you tick it.</p>
      <ul className="mt-3 space-y-2">
        {drafts.map((d) => (
          <li key={d.id}>
            <label className="flex min-h-11 items-start gap-3 text-[0.9375rem]">
              <input
                type="checkbox"
                className="mt-1 size-5 shrink-0 accent-[var(--color-accent)]"
                checked={picked.has(d.id)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(d.id);
                  else next.delete(d.id);
                  setPicked(next);
                }}
              />
              <span className="min-w-0">
                <span className="font-semibold">{d.name}</span>
                <span className="block text-sm">{d.price || "no price yet"}</span>
                {d.handedOverBy ? <span className="block text-xs text-muted">handed over by {agentName(d.handedOverBy)}{d.handedOverAt ? `, ${day(d.handedOverAt)}` : ""}: tick to include</span> : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-bad">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={busy || !picked.size} onClick={go}>
          {busy ? "Publishing…" : `Publish ${picked.size} package${picked.size === 1 ? "" : "s"}`}
        </button>
        <button type="button" className={btnOutline} disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const FIELDS = ["name", "price", "offer", "buyer", "deliverables", "status", "email", "why", "sources"] as const;
/** The changed fields of a form, as the API takes them (lists split back into lines). */
function changedFields(base: PackageDraft, form: PackageDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) {
    if (form[k] === base[k]) continue;
    out[k] = k === "deliverables" ? form.deliverables.split("\n") : k === "sources" ? form.sources.split("\n").map((u) => u.trim()).filter(Boolean) : form[k];
  }
  return out;
}
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

type Open = { id: string | null; base: PackageDraft; form: PackageDraft; since?: string };

/** One package's form, in place of its card: Save and Cancel at its foot, Delete for a saved one. */
function PackageForm({ open, onChange, onSave, onCancel, onDelete, busy, error }: {
  open: Open; onChange: (p: Partial<PackageDraft>) => void; onSave: () => void; onCancel: () => void; onDelete: () => void; busy: boolean; error: string;
}) {
  const p = open.form;
  const dirty = JSON.stringify(open.base) !== JSON.stringify(p);
  const label = p.name || (open.id ? "this package" : "the new package");
  // focus moves into the form when it opens (its first field), and the form scrolls into view
  const box = useRef<HTMLFormElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView({ block: "nearest" });
    box.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, [open.id]);
  return (
    <form
      ref={box}
      data-package-form={open.id ?? "new"}
      className="flex flex-col gap-3 rounded-2xl border border-accent bg-panel p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      aria-label={`Edit ${label}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-muted">{open.id ? `Editing ${open.base.name}` : "New package"}</span>
        {dirty ? <ChangedDot /> : null}
      </div>
      <label className={fieldLabel}>
        Name
        <input className={control} value={p.name} onChange={(e) => onChange({ name: e.target.value })} />
      </label>
      <label className={fieldLabel}>
        Price and timeline
        <input className={control} value={p.price} placeholder="$990 one-time, one week" onChange={(e) => onChange({ price: e.target.value })} />
      </label>
      <label className={fieldLabel}>
        The offer in one line
        <input className={control} value={p.offer} onChange={(e) => onChange({ offer: e.target.value })} />
      </label>
      <label className={fieldLabel}>
        Who buys it
        <textarea className={`${control} h-auto py-2 leading-snug`} rows={2} value={p.buyer} onChange={(e) => onChange({ buyer: e.target.value })} />
      </label>
      <label className={fieldLabel}>
        What they get (one per line)
        <textarea className={`${control} h-auto min-h-32 py-2 leading-snug`} rows={Math.max(4, p.deliverables.split("\n").length + 1)} value={p.deliverables} onChange={(e) => onChange({ deliverables: e.target.value })} />
      </label>
      <label className={fieldLabel}>
        Ready-to-send email (the {agentName("Outreach Writer")} builds the first email on it)
        <textarea className={`${control} h-auto min-h-40 py-2 leading-snug`} rows={Math.min(16, Math.max(6, p.email.split("\n").length + 1))} value={p.email} onChange={(e) => onChange({ email: e.target.value })} />
      </label>
      <label className={fieldLabel}>
        Status
        <select className={control} value={p.status} onChange={(e) => onChange({ status: e.target.value as PackageStatus })}>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
      </label>
      <label className={fieldLabel}>
        Why this price
        <textarea className={`${control} h-auto py-2 leading-snug`} rows={2} value={p.why} onChange={(e) => onChange({ why: e.target.value })} />
      </label>
      <label className={fieldLabel}>
        Sources (one web address per line)
        <textarea className={`${control} h-auto py-2 leading-snug`} rows={2} value={p.sources} onChange={(e) => onChange({ sources: e.target.value })} />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button type="submit" className={btnPrimary} disabled={busy || (!!open.id && !dirty)}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className={btnOutline} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {open.id ? (
          <button type="button" className={`${btnText} ml-auto text-bad`} disabled={busy} onClick={onDelete}>
            Delete package
          </button>
        ) : null}
      </div>
      <p className="text-xs text-muted">Esc cancels. Only the fields you change are saved.</p>
    </form>
  );
}

function ChangedDot() {
  return (
    <span data-changed className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-ink">
      <span aria-hidden className="size-2 rounded-full bg-accent" />
      Changed, not saved
    </span>
  );
}

/** "Save or discard changes to <name>?" when another package is opened while one has unsaved changes. */
function SwitchAsk({ name, onSave, onDiscard, onStay, busy }: { name: string; onSave: () => void; onDiscard: () => void; onStay: () => void; busy: boolean }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div role="alertdialog" aria-modal="true" aria-labelledby="switch-ask" className="w-full max-w-sm rounded-2xl border border-line bg-panel p-4 shadow-xl">
        <h3 id="switch-ask" className="font-semibold">
          Save or discard changes to {name}?
        </h3>
        <p className={helper}>Only one package is edited at a time.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button ref={first} type="button" className={btnPrimary} disabled={busy} onClick={onSave}>
            Save
          </button>
          <button type="button" className={btnOutline} disabled={busy} onClick={onDiscard}>
            Discard
          </button>
          <button type="button" className={btnText} disabled={busy} onClick={onStay}>
            Keep editing
          </button>
        </div>
      </div>
    </div>
  );
}

function PackagesSection({ packages, canEdit, isOwner }: { packages: Package[]; canEdit: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<Open | null>(null);
  const [ask, setAsk] = useState<{ next: Open | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Record<string, { at: string; by: string }>>({});
  const dirty = !!open && JSON.stringify(open.base) !== JSON.stringify(open.form);
  const editOf = (p: Package): Open => ({ id: p.id, base: toDraft(p), form: toDraft(p), since: p.updatedAt });
  const fresh = (): Open => ({ id: null, base: blank(), form: blank() });
  /** Open a package (or a new one): straight away, or after "Save or discard" when the open one has changes. */
  const go = (next: Open | null) => {
    setError("");
    if (dirty) return setAsk({ next });
    setOpen(next);
  };
  const saveOpen = async (): Promise<boolean> => {
    if (!open) return true;
    if (!open.form.name.trim()) {
      setError("The package needs a name.");
      return false;
    }
    setBusy(true);
    setError("");
    try {
      const fields = changedFields(open.base, open.form);
      const r = open.id
        ? await fetch(`/api/assets/package/${open.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields, since: open.since }) })
        : await fetch("/api/assets/package", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: { ...fields, name: open.form.name } }) });
      const d = (await r.json()) as { ok: boolean; error?: string; package?: Package };
      if (!d.ok || !d.package) {
        setError(d.error ?? "Not saved.");
        return false;
      }
      setSaved((s) => ({ ...s, [d.package!.id]: { at: d.package!.updatedAt, by: d.package!.updatedBy } }));
      setOpen(null);
      router.refresh();
      return true;
    } catch {
      setError("No answer from the server: not saved.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!open?.id || !window.confirm(`Delete "${open.base.name}"? The bots stop offering it.`)) return;
    setBusy(true);
    const r = await fetch(`/api/assets/package/${open.id}`, { method: "DELETE" }).then((x) => x.json() as Promise<{ ok: boolean; error?: string }>).catch(() => ({ ok: false, error: "No answer from the server." }));
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Not deleted.");
    setOpen(null);
    router.refresh();
  };
  const cancel = () => {
    if (dirty && !window.confirm(`Discard your changes to ${open?.base.name || "the new package"}?`)) return;
    setError("");
    setOpen(null);
  };
  // Esc cancels the open form (the switch question has its own Esc: keep editing)
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (ask) setAsk(null);
      else cancel();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  });
  // leaving the page with unsaved changes asks the browser's question
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const published = packages.filter((p) => p.status === "published").length;
  const drafts = packages.filter((p) => p.status === "draft");
  const publishOne = async (p: Package) => {
    if (!window.confirm(`Publish "${p.name}" at ${p.price || "no price yet"}? It is then offered to leads.`)) return;
    const r = await publish([p.id]);
    if (!r.ok) return setError(r.error ?? "Not published.");
    router.refresh();
  };
  const form = (
    <PackageForm
      open={open!}
      onChange={(p) => open && setOpen({ ...open, form: { ...open.form, ...p } })}
      onSave={() => void saveOpen()}
      onCancel={cancel}
      onDelete={() => void remove()}
      busy={busy}
      error={error}
    />
  );
  return (
    <section aria-labelledby="packages" className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="packages" className={sectionTitle}>
          All packages
        </h2>
        {canEdit && open?.id !== null ? (
          <button type="button" className={btnText} onClick={() => go(fresh())}>
            + Add a package
          </button>
        ) : null}
      </div>
      {isOwner && !open && drafts.length ? <PublishAll drafts={drafts} onDone={() => router.refresh()} /> : null}
      {error && !open ? (
        <p role="alert" className="mt-2 text-sm text-bad">
          {error}
        </p>
      ) : null}
      <p className={helper}>
        The offers as a client sees them. Only a published package is offered; a draft waits for the owner or The CEO.
        {packages.length ? ` ${published} of ${packages.length} published.` : ""}
      </p>

      {packages.length || open ? (
        <>
          <ol className={`mt-4 grid gap-4 lg:grid-cols-2 ${open ? "items-start" : ""}`}>
            {packages.map((p) =>
              open?.id === p.id ? (
                <li key={p.id}>{form}</li>
              ) : (
                <li key={p.id} data-package={p.id} className="flex flex-col rounded-2xl border border-line bg-panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-base font-semibold">{p.name}</h3>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusChip status={p.status} />
                      {canEdit ? (
                        <button type="button" className="inline-flex min-h-11 items-center px-1 text-sm font-medium text-accent-ink hover:underline" onClick={() => go(editOf(p))} aria-label={`Edit ${p.name}`}>
                          Edit
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {p.price ? <p className="mt-1 text-[0.9375rem] font-medium">{p.price}</p> : null}
                  {p.offer ? <p className="mt-2 text-sm">{p.offer}</p> : null}
                  {p.buyer ? (
                    <p className="mt-2 text-sm text-muted">
                      <span className="font-medium text-ink">For:</span> {p.buyer}
                    </p>
                  ) : null}
                  {p.deliverables.length ? (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                      {p.deliverables.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  ) : null}
                  <More p={p} />
                  <Handover p={p} />
                  {saved[p.id] ? (
                    <p data-saved className="mt-3 text-xs text-muted" suppressHydrationWarning>
                      Saved {hhmm(saved[p.id].at)} by {agentName(saved[p.id].by)}
                    </p>
                  ) : null}
                  {canEdit && p.status === "draft" ? (
                    <div className="mt-3">
                      <button type="button" className={btnOutline} onClick={() => void publishOne(p)}>
                        Publish
                      </button>
                    </div>
                  ) : null}
                </li>
              ),
            )}
            {open && open.id === null ? <li>{form}</li> : null}
          </ol>
          <Updated rows={packages} />
        </>
      ) : (
        <p className="mt-4 rounded-2xl border border-line bg-panel p-4 text-sm text-muted">No packages yet.{canEdit ? " Add the first with + Add a package." : ""}</p>
      )}
      {ask && open ? (
        <SwitchAsk
          name={open.base.name || "the new package"}
          busy={busy}
          onSave={async () => {
            const next = ask.next;
            if (await saveOpen()) {
              setAsk(null);
              setOpen(next);
            } else setAsk(null);
          }}
          onDiscard={() => {
            setOpen(ask.next);
            setAsk(null);
          }}
          onStay={() => setAsk(null)}
        />
      ) : null}
    </section>
  );
}

export default function PackagesView({ packages, canEdit, isOwner = false }: { packages: Package[]; canEdit: boolean; isOwner?: boolean }) {
  return (
    <>
      <h1 className={pageTitle}>Packages</h1>
      <p className={pageLead}>
        What we offer, ready to pitch: the price, who buys it and what they get. The {agentName("Outreach Writer")} builds a lead&rsquo;s first email on a published package.{" "}
        {canEdit ? "You and the other managers edit them; the owner publishes." : "The owner and managers keep them up to date."}
      </p>
      <PackagesSection packages={packages} canEdit={canEdit} isOwner={isOwner} />
    </>
  );
}
