"use client";
// The Packages page: the packages (name, price and timeline, the offer in a
// line, who buys it, what they get, draft or published), a bot's handover, and Publish. Everyone reads it; the owner and
// managers edit the list as a whole and save it in the order shown, so the bots (GET /v1/assets/packages) read the
// same packages in the same order.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Package, PackageStatus } from "@/lib/assets";
import { btnOutline, btnPrimary, btnText, control, fieldLabel, helper, pageLead, pageTitle, sectionTitle } from "@/lib/ui-classes";
import { RowTools, Updated, day, move, newKey, save } from "../asset/list-tools";

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
            Handed over by {p.handedOverBy}, {day(p.handedOverAt)}. Check the price, then publish it.
          </p>
        ) : (
          <p>
            First handed over by {p.handedOverBy}, {day(p.handedOverAt)}.
          </p>
        )}
        {p.status === "draft" && why ? <p className="mt-1">Why: {why}</p> : null}
        {p.status === "draft" && p.reviewedBy && p.reviewedAt ? (
          <p data-review={p.reviewVerdict ?? ""} className={`mt-1 ${p.reviewVerdict === "revise" ? "text-bad" : "text-ink"}`}>
            Reviewed by {p.reviewedBy}, {day(p.reviewedAt)}: <span className="font-semibold">{p.reviewVerdict === "approve" ? "approve" : "revise"}</span>
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
      <p className={helper}>Published packages are offered: the Outreach Writer and the price check read them. A draft a bot handed over is included only when you tick it.</p>
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
                {d.handedOverBy ? <span className="block text-xs text-muted">handed over by {d.handedOverBy}{d.handedOverAt ? `, ${day(d.handedOverAt)}` : ""}: tick to include</span> : null}
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

function PackagesSection({ packages, canEdit, isOwner }: { packages: Package[]; canEdit: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<PackageDraft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: string, p: Partial<PackageDraft>) => draft && setDraft(draft.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const submit = async () => {
    if (!draft) return;
    const unnamed = draft.findIndex((p) => !p.name.trim());
    if (unnamed >= 0) return setError(`Package ${unnamed + 1} needs a name.`);
    setBusy(true);
    const r = await save(
      "packages",
      draft.map(({ id, name, price, offer, buyer, deliverables, status, email, why, sources }) => ({
        id,
        name,
        price,
        offer,
        buyer,
        deliverables: deliverables.split("\n"),
        status,
        email,
        why,
        sources: sources.split("\n").map((u) => u.trim()).filter(Boolean),
      })),
      packages.map((x) => x.id),
    );
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Not saved.");
    setDraft(null);
    router.refresh();
  };
  const published = packages.filter((p) => p.status === "published").length;
  const drafts = packages.filter((p) => p.status === "draft");
  const publishOne = async (p: Package) => {
    if (!window.confirm(`Publish "${p.name}" at ${p.price || "no price yet"}? It is then offered to leads.`)) return;
    const r = await publish([p.id]);
    if (!r.ok) return setError(r.error ?? "Not published.");
    router.refresh();
  };
  return (
    <section aria-labelledby="packages" className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="packages" className={sectionTitle}>
          All packages
        </h2>
        {canEdit && !draft ? (
          <button
            type="button"
            className={btnText}
            onClick={() => {
              setError("");
              setDraft(packages.length ? packages.map(toDraft) : [blank()]);
            }}
          >
            Edit packages
          </button>
        ) : null}
      </div>
      {isOwner && !draft && drafts.length ? <PublishAll drafts={drafts} onDone={() => router.refresh()} /> : null}
      {error && !draft ? (
        <p role="alert" className="mt-2 text-sm text-bad">
          {error}
        </p>
      ) : null}
      <p className={helper}>
        The offers as a client sees them. Only a published package is offered; a draft waits for the owner or The CEO.
        {packages.length ? ` ${published} of ${packages.length} published.` : ""}
      </p>

      {draft ? (
        <div className="mt-4 space-y-4">
          {draft.map((p, i) => (
            <fieldset key={p.key} className="rounded-2xl border border-line bg-panel p-4">
              <legend className="sr-only">Package {i + 1}</legend>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-muted">Package {i + 1}</span>
                <RowTools i={i} count={draft.length} what={p.name || `package ${i + 1}`} onMove={(by) => setDraft(move(draft, i, by))} onRemove={() => setDraft(draft.filter((x) => x.key !== p.key))} />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className={fieldLabel}>
                  Name
                  <input className={control} value={p.name} onChange={(e) => set(p.key, { name: e.target.value })} />
                </label>
                <label className={fieldLabel}>
                  Status
                  <select className={control} value={p.status} onChange={(e) => set(p.key, { status: e.target.value as PackageStatus })}>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                  </select>
                </label>
                <label className={`${fieldLabel} sm:col-span-2`}>
                  Price and timeline
                  <input className={control} value={p.price} placeholder="$500 one-time, one week" onChange={(e) => set(p.key, { price: e.target.value })} />
                </label>
                <label className={`${fieldLabel} sm:col-span-2`}>
                  The offer in one line
                  <input className={control} value={p.offer} onChange={(e) => set(p.key, { offer: e.target.value })} />
                </label>
                <label className={`${fieldLabel} sm:col-span-2`}>
                  Who buys it
                  <textarea className={`${control} h-auto py-2 leading-snug`} rows={2} value={p.buyer} onChange={(e) => set(p.key, { buyer: e.target.value })} />
                </label>
                <label className={`${fieldLabel} sm:col-span-2`}>
                  What they get (one per line)
                  <textarea
                    className={`${control} h-auto min-h-32 py-2 leading-snug`}
                    rows={Math.max(4, p.deliverables.split("\n").length + 1)}
                    value={p.deliverables}
                    onChange={(e) => set(p.key, { deliverables: e.target.value })}
                  />
                </label>
                <label className={`${fieldLabel} sm:col-span-2`}>
                  Ready-to-send email (the Outreach Writer builds the first email on it)
                  <textarea
                    className={`${control} h-auto min-h-40 py-2 leading-snug`}
                    rows={Math.min(16, Math.max(6, p.email.split("\n").length + 1))}
                    value={p.email}
                    onChange={(e) => set(p.key, { email: e.target.value })}
                  />
                </label>
                <label className={`${fieldLabel} sm:col-span-2`}>
                  Why this price
                  <textarea className={`${control} h-auto py-2 leading-snug`} rows={2} value={p.why} onChange={(e) => set(p.key, { why: e.target.value })} />
                </label>
                <label className={`${fieldLabel} sm:col-span-2`}>
                  Sources (one web address per line)
                  <textarea className={`${control} h-auto py-2 leading-snug`} rows={2} value={p.sources} onChange={(e) => set(p.key, { sources: e.target.value })} />
                </label>
              </div>
            </fieldset>
          ))}
          <button type="button" className={btnText} onClick={() => setDraft([...draft, blank()])}>
            + Add a package
          </button>
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={submit}>
              {busy ? "Saving…" : "Save packages"}
            </button>
            <button type="button" className={btnOutline} disabled={busy} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : packages.length ? (
        <>
          <ol className="mt-4 grid gap-4 lg:grid-cols-2">
            {packages.map((p) => (
              <li key={p.id} className="flex flex-col rounded-2xl border border-line bg-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold">{p.name}</h3>
                  <StatusChip status={p.status} />
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
                {canEdit && p.status === "draft" ? (
                  <div className="mt-3">
                    <button type="button" className={btnOutline} onClick={() => void publishOne(p)}>
                      Publish
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          <Updated rows={packages} />
        </>
      ) : (
        <p className="mt-4 rounded-2xl border border-line bg-panel p-4 text-sm text-muted">No packages yet.{canEdit ? " Edit packages to add the first." : ""}</p>
      )}
    </section>
  );
}

export default function PackagesView({ packages, canEdit, isOwner = false }: { packages: Package[]; canEdit: boolean; isOwner?: boolean }) {
  return (
    <>
      <h1 className={pageTitle}>Packages</h1>
      <p className={pageLead}>
        What we offer, ready to pitch: the price, who buys it and what they get. The Outreach Writer builds a lead&rsquo;s first email on a published package.{" "}
        {canEdit ? "You and the other managers edit them; the owner publishes." : "The owner and managers keep them up to date."}
      </p>
      <PackagesSection packages={packages} canEdit={canEdit} isOwner={isOwner} />
    </>
  );
}
