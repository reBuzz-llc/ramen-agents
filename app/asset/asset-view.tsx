"use client";
// The Asset page, "What we have": the company's text section by section (services, products, the rate card in its
// place, who does what, ideal customers, proof, how you deliver, contact and legal names, whatever the team keeps);
// then the brochures and PDFs from Files. The packages have
// their own page (/packages). Everyone reads it; the owner and managers edit a section in place, and the bots read the
// same sections (GET /v1/assets/sections) and the rate card (GET /v1/assets/rates).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Rate, Section, SectionKind } from "@/lib/assets";
import { btnDanger, btnOutline, btnPrimary, btnText, control, fieldLabel, helper, pageLead, pageTitle, sectionTitle } from "@/lib/ui-classes";
import { linkify, parseBody, type Block, type ListBlock } from "@/lib/what-we-have";
import { RowTools, Updated, move, newKey, save } from "./list-tools";

type Pdf = { id: string; name: string; tag: string; size: number };
type RateDraft = { key: string; id?: string; line: string };
type SectionDraft = { key: string; id?: string; title: string; kind: SectionKind; body: string };

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

function Linked({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((r, i) =>
        r.href ? (
          <a key={i} href={r.href} target="_blank" rel="noreferrer" className="break-all text-accent-ink underline underline-offset-2">
            {r.text}
          </a>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

function List({ list }: { list: ListBlock }) {
  const items = list.items.map((it, i) => (
    <li key={i} className="pl-1">
      <Linked text={it.text} />
      {it.children.map((c, j) => (
        <List key={j} list={c} />
      ))}
    </li>
  ));
  return list.ordered ? <ol className="mt-1 list-decimal space-y-1 pl-6 marker:text-muted">{items}</ol> : <ul className="mt-1 list-disc space-y-1 pl-6 marker:text-muted">{items}</ul>;
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i} className="mt-2">
            <Linked text={b.text} />
          </p>
        ) : b.kind === "list" ? (
          <List key={i} list={b} />
        ) : (
          <details key={i} className="group mt-2 rounded-xl border border-line bg-panel">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 font-semibold [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="inline-block text-muted transition-transform group-open:rotate-90">
                ▸
              </span>
              <span className="min-w-0">
                <Linked text={b.title} />
              </span>
            </summary>
            <div className="border-t border-line px-4 pt-1 pb-3">{b.children.length ? <Blocks blocks={b.children} /> : <p className="mt-2 text-sm text-muted">Empty.</p>}</div>
          </details>
        ),
      )}
    </>
  );
}

/** A section's body: toggles, nested lists, paragraphs, links. */
export function Body({ text }: { text: string }) {
  return (
    <div className="mt-2 text-[0.9375rem] leading-relaxed">
      <Blocks blocks={parseBody(text)} />
    </div>
  );
}

function RatesSection({ rates, canEdit, title, body, tools }: { rates: Rate[]; canEdit: boolean; title: string; body: string; tools?: React.ReactNode }) {
  const router = useRouter();
  const [draft, setDraft] = useState<RateDraft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = () => {
    setError("");
    setDraft(rates.length ? rates.map((r) => ({ key: r.id, id: r.id, line: r.line })) : [{ key: newKey(), line: "" }]);
  };
  const submit = async () => {
    if (!draft) return;
    setBusy(true);
    const r = await save("rates", draft.map(({ id, line }) => ({ id, line })), rates.map((x) => x.id));
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Not saved.");
    setDraft(null);
    router.refresh();
  };
  return (
    <section aria-labelledby="rates" className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="rates" className={sectionTitle}>
          {title || "Rates"}
        </h2>
        {canEdit && !draft ? (
          <span className="flex items-center gap-3">
            {tools}
            <button type="button" className={btnText} onClick={start}>
              Edit rates
            </button>
          </span>
        ) : null}
      </div>
      {body ? <Body text={body} /> : <p className={helper}>The rate card, one line per offer as &ldquo;Offer: price&rdquo;. The bots price from these lines, and they win over any market figure a bot finds.</p>}

      {draft ? (
        <div className="mt-4 space-y-2">
          {draft.map((r, i) => (
            <div key={r.key} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-right text-sm text-muted tabular-nums">{i + 1}</span>
              <input
                className={control}
                value={r.line}
                aria-label={`Rate line ${i + 1}`}
                placeholder="Offer: price"
                onChange={(e) => setDraft(draft.map((x) => (x.key === r.key ? { ...x, line: e.target.value } : x)))}
              />
              <RowTools i={i} count={draft.length} what={`line ${i + 1}`} onMove={(by) => setDraft(move(draft, i, by))} onRemove={() => setDraft(draft.filter((x) => x.key !== r.key))} />
            </div>
          ))}
          <button type="button" className={btnText} onClick={() => setDraft([...draft, { key: newKey(), line: "" }])}>
            + Add a line
          </button>
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={submit}>
              {busy ? "Saving…" : "Save rates"}
            </button>
            <button type="button" className={btnOutline} disabled={busy} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : rates.length ? (
        <>
          <ol className="mt-4 divide-y divide-line rounded-2xl border border-line bg-panel">
            {rates.map((r) => (
              <li key={r.id} className="px-4 py-3 text-[0.9375rem]">
                {r.price ? (
                  <>
                    <span className="font-semibold">{r.offer}:</span> {r.price}
                  </>
                ) : (
                  r.line
                )}
              </li>
            ))}
          </ol>
          <Updated rows={rates} />
        </>
      ) : (
        <p className="mt-4 rounded-2xl border border-line bg-panel p-4 text-sm text-muted">No rates yet.{canEdit ? " Edit rates to add the first line." : " The owner adds them."}</p>
      )}
    </section>
  );
}

const slug = (s: Section, i: number) => `s-${i}-${s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

/** One section's editor: its title and its body in the page's light markdown. */
function SectionEditor({ draft, onChange, onSave, onCancel, onRemove, busy, error }: { draft: SectionDraft; onChange: (d: SectionDraft) => void; onSave: () => void; onCancel: () => void; onRemove?: () => void; busy: boolean; error: string }) {
  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-line bg-panel p-4">
      <label className="block">
        <span className={fieldLabel}>Title</span>
        <input className={control} value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} placeholder="Services" />
      </label>
      <label className="block">
        <span className={fieldLabel}>{draft.kind === "rates" ? "Above the rate card" : "Text"}</span>
        <textarea className={`${control} min-h-56 font-mono text-sm`} value={draft.body} onChange={(e) => onChange({ ...draft, body: e.target.value })} spellCheck />
      </label>
      <p className={helper}>
        <code>### Name</code> starts a toggle; <code>- </code> or <code>1. </code> starts a list item; two spaces in front put it one level deeper. Links are pasted as they are.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={onSave}>
          {busy ? "Saving…" : "Save section"}
        </button>
        <button type="button" className={btnOutline} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {onRemove ? (
          <button type="button" className={`${btnDanger} ml-auto`} disabled={busy} onClick={onRemove}>
            Remove section
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Sections({ sections, rates, canEdit }: { sections: Section[]; rates: Rate[]; canEdit: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = useState<SectionDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const known = sections.map((s) => s.id);
  const asIn = (s: Section | SectionDraft) => ({ id: s.id, title: s.title, kind: s.kind, body: s.body });
  const commit = async (list: { id?: string; title: string; kind: SectionKind; body: string }[]) => {
    setBusy(true);
    setError("");
    const r = await save("sections", list, known);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Not saved.");
      return false;
    }
    setEdit(null);
    router.refresh();
    return true;
  };
  const saveEdit = () => {
    if (!edit) return;
    if (!edit.title.trim() && !edit.body.trim() && edit.kind !== "rates") return setError("Give the section a title or some text.");
    const list = edit.id ? sections.map((s) => (s.id === edit.id ? asIn(edit) : asIn(s))) : [...sections.map(asIn), asIn(edit)];
    void commit(list);
  };
  const remove = (id: string) => {
    if (!window.confirm("Remove this section for everyone?")) return;
    void commit(sections.filter((s) => s.id !== id).map(asIn));
  };
  const shift = (i: number, by: -1 | 1) => void commit(move(sections, i, by).map(asIn));
  const hasRates = sections.some((s) => s.kind === "rates");

  const tools = (s: Section, i: number) =>
    canEdit && !edit ? (
      <span className="flex items-center gap-1">
        <button type="button" className={`${btnText} px-2`} aria-label={`Move ${s.title || "section"} up`} disabled={busy || i === 0} onClick={() => shift(i, -1)}>
          ↑
        </button>
        <button type="button" className={`${btnText} px-2`} aria-label={`Move ${s.title || "section"} down`} disabled={busy || i === sections.length - 1} onClick={() => shift(i, 1)}>
          ↓
        </button>
        <button type="button" className={btnText} onClick={() => (setError(""), setEdit({ key: s.id, ...asIn(s) }))}>
          Edit
        </button>
      </span>
    ) : null;

  return (
    <>
      {error && !edit ? (
        <p role="alert" className="mt-4 text-sm text-bad">
          {error}
        </p>
      ) : null}
      {sections.map((s, i) =>
        edit?.id === s.id ? (
          <section key={s.id} className="mt-10" aria-label={`Editing ${s.title || "section"}`}>
            <SectionEditor draft={edit} onChange={setEdit} onSave={saveEdit} onCancel={() => setEdit(null)} onRemove={s.kind === "rates" ? undefined : () => remove(s.id)} busy={busy} error={error} />
          </section>
        ) : s.kind === "rates" ? (
          <RatesSection key={s.id} rates={rates} canEdit={canEdit} title={s.title} body={s.body} tools={tools(s, i)} />
        ) : (
          <section key={s.id} aria-labelledby={s.title ? slug(s, i) : undefined} className={s.title ? "mt-10" : "mt-6"}>
            {s.title || tools(s, i) ? (
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {s.title ? (
                  <h2 id={slug(s, i)} className={sectionTitle}>
                    {s.title}
                  </h2>
                ) : (
                  <span />
                )}
                {tools(s, i)}
              </div>
            ) : null}
            {s.body ? <Body text={s.body} /> : <p className="mt-2 text-sm text-muted">Nothing here yet.</p>}
          </section>
        ),
      )}
      {!hasRates ? <RatesSection rates={rates} canEdit={canEdit} title="Rates" body="" /> : null}
      {canEdit ? (
        edit && !edit.id ? (
          <section className="mt-10" aria-label="New section">
            <SectionEditor draft={edit} onChange={setEdit} onSave={saveEdit} onCancel={() => setEdit(null)} busy={busy} error={error} />
          </section>
        ) : !edit ? (
          <button type="button" className={`${btnText} mt-8`} onClick={() => (setError(""), setEdit({ key: newKey(), title: "", kind: "text", body: "" }))}>
            + Add a section
          </button>
        ) : null
      ) : null}
      {sections.length ? <Updated rows={sections} /> : null}
    </>
  );
}

export default function AssetView({ sections, rates, pdfs, canEdit }: { sections: Section[]; rates: Rate[]; pdfs: Pdf[]; canEdit: boolean }) {
  return (
    <>
      <h1 className={pageTitle}>What we have</h1>
      <p className={pageLead}>
        What the company has and charges: services, products, the rate card, who does what. It is the truth about us, and it wins over any figure a bot finds.{" "}
        {canEdit ? "You and the other managers edit it; the team and the bots read it." : "The owner and managers keep it up to date."} The packages have{" "}
        <Link href="/packages" className="underline">
          their own page
        </Link>
        .
      </p>

      <Sections sections={sections} rates={rates} canEdit={canEdit} />

      <section aria-labelledby="brochures" className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="brochures" className={sectionTitle}>
            Brochures and PDFs
          </h2>
          <Link href="/files" className={btnText}>
            Open Files
          </Link>
        </div>
        <p className={helper}>The PDFs on the Files page. Upload, rename or tag them there; attach them to a lead from its drawer.</p>
        {pdfs.length ? (
          <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-panel">
            {pdfs.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-bad/15 text-[10px] font-bold text-bad">
                  PDF
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem]">{f.name}</span>
                  <span className="block text-xs text-muted">
                    {f.tag ? `${f.tag} · ` : ""}
                    {size(f.size)}
                  </span>
                </span>
                <a href={`/api/files/${f.id}/download?inline=1`} target="_blank" rel="noreferrer" className={btnText}>
                  Open
                </a>
                <a href={`/api/files/${f.id}/download`} className={btnText}>
                  Download
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-2xl border border-line bg-panel p-4 text-sm text-muted">
            No PDFs yet. <Link href="/files" className="underline">Upload one on the Files page</Link>.
          </p>
        )}
      </section>
    </>
  );
}
