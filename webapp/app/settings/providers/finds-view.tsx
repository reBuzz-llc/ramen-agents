"use client";

import { useState } from "react";
import { sendJson } from "@/lib/client";
import { keyPage } from "@/lib/key-pages";
import type { TestResult } from "@/lib/keys";
import type { FindRow, Verdict } from "@/lib/provider-finds";
import { usePoll } from "../../hooks";
import { Badge, buttonClass, Panel, Spinner } from "../../ui";

// New finds (owner, 2026-11-12): the Scout's free APIs waiting for the owner. Get a key on the provider's site, test it
// here (one tiny call), save it if it is worth keeping, then mark it usable or unusable with a note; the blog's
// /free-ai-apis page shows the marks at its next build. The marks already made are below, each one editable.
const LEVEL_TONE = { works: "good", valid: "info", "no-quota": "warn", rejected: "bad", error: "bad" } as const;
const field = "w-full min-w-0 rounded-lg bg-fill-3 px-3 py-2 text-sm text-ink placeholder:text-muted focus:ring-2 focus:ring-sys-blue/40 focus:outline-none";
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

type Data = { finds: FindRow[]; decided: Verdict[] };

/** The provider's own site: a source on the endpoint's domain, else that domain's home; never a list that mentioned it. */
function providerSite(f: FindRow): string {
  const dom = (u: string) => host(u).split(".").slice(-2).join(".");
  const own = f.endpoint ? dom(f.endpoint) : "";
  if (!own) return "";
  return f.sources.find((s) => dom(s) === own) ?? `https://${own}/`;
}

function MarkForm({ name, slug, kind, url, free, note: note0, onDone }: { name: string; slug: string; kind: "model" | "tool"; url: string; free: string; note?: string; onDone: () => void }) {
  const [note, setNote] = useState(note0 ?? "");
  const [k, setK] = useState(kind);
  const [busy, setBusy] = useState<"usable" | "unusable" | null>(null);
  const [error, setError] = useState("");
  const mark = async (verdict: "usable" | "unusable") => {
    setBusy(verdict);
    setError("");
    const sent = await sendJson<{ ok?: boolean; error?: string }>("/api/provider-finds", "POST", { action: "mark", name, slug, verdict, note, kind: k, url, free });
    setBusy(null);
    if (sent.ok && sent.body?.ok) onDone();
    else setError(sent.body?.error ?? sent.error ?? "could not save");
  };
  return (
    <div className="mt-3 space-y-2">
      <label className="block text-xs font-semibold text-muted">
        Your note (on the blog page)
        <input className={`${field} mt-1`} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Free, no card: answered our test in a second" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select className="rounded-lg bg-fill-3 px-2 py-1.5 text-sm text-ink" value={k} onChange={(e) => setK(e.target.value as "model" | "tool")} aria-label="Kind">
          <option value="model">AI model</option>
          <option value="tool">Search, email or other tool</option>
        </select>
        <button type="button" className={buttonClass("prominent", "sm")} disabled={busy !== null || !note.trim()} onClick={() => void mark("usable")}>
          {busy === "usable" ? <Spinner small /> : null}
          Usable
        </button>
        <button type="button" className={buttonClass("gray", "sm")} disabled={busy !== null || !note.trim()} onClick={() => void mark("unusable")}>
          {busy === "unusable" ? <Spinner small /> : null}
          Unusable
        </button>
      </div>
      {error ? <p className="text-xs text-bad">{error}</p> : null}
    </div>
  );
}

function FindCard({ f, onDone }: { f: FindRow; onDone: () => void }) {
  const [endpoint, setEndpoint] = useState(f.test?.endpoint ?? f.endpoint);
  const [model, setModel] = useState(f.test?.model ?? f.models[0] ?? "");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [result, setResult] = useState<TestResult | null>(f.test ? { ok: f.test.ok, level: f.test.level as TestResult["level"], message: f.test.message } : null);
  const [saved, setSaved] = useState(f.hasKey ? `A key is saved as common-data/keys/${f.slug}.key.` : "");
  const [error, setError] = useState("");
  const get = keyPage(f.slug)?.url ?? providerSite(f);
  const run = async (what: "test" | "save") => {
    setBusy(what);
    setError("");
    if (what === "test") {
      const sent = await sendJson<TestResult & { error?: string }>("/api/provider-finds", "POST", { action: "test", slug: f.slug, endpoint, model, key: key.trim() || undefined });
      if (sent.body?.level) setResult(sent.body);
      else setError(sent.body?.error ?? sent.error ?? "the test did not run");
    } else {
      const sent = await sendJson<{ ok?: boolean; file?: string; ending?: string; error?: string }>("/api/provider-finds", "POST", { action: "save", slug: f.slug, key: key.trim() });
      if (sent.ok && sent.body?.ok) {
        setSaved(`Saved the key ending in ${sent.body.ending} as ${sent.body.file}. A provider the bots already know starts being used at their next restart.`);
        setKey("");
      } else setError(sent.body?.error ?? sent.error ?? "could not save");
    }
    setBusy(null);
  };
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">{f.name}</h3>
        <span className="text-xs text-muted">{f.found ? `found ${f.found}` : "found by the Scout"}</span>
      </div>
      {f.free ? <p className="mt-1 text-sm break-words text-ink">{f.free}</p> : null}
      {f.why ? <p className="mt-1 line-clamp-3 text-xs break-words text-muted">{f.why}</p> : null}
      <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {get ? (
          <a href={get} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline">
            Get a key at {host(get)} ↗
          </a>
        ) : null}
        {f.sources.filter((s) => s !== get).slice(0, 3).map((s) => (
          <a key={s} href={s} target="_blank" rel="noopener noreferrer" className="text-muted underline">
            {host(s)}
          </a>
        ))}
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-semibold text-muted">Test a key</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="block text-xs text-muted">
            Endpoint
            <input className={`${field} mt-1 font-mono`} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.example.com/v1" />
          </label>
          <label className="block text-xs text-muted">
            Model to ask
            <input className={`${field} mt-1 font-mono`} value={model} onChange={(e) => setModel(e.target.value)} list={`models-${f.slug}`} placeholder="a model id" />
            <datalist id={`models-${f.slug}`}>
              {f.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label className="block text-xs text-muted sm:col-span-2">
            API key {f.hasKey ? "(empty: the saved one)" : ""}
            <input className={`${field} mt-1 font-mono`} type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste the key" />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass("tinted", "sm")} disabled={busy !== null || (!key.trim() && !f.hasKey)} onClick={() => void run("test")}>
            {busy === "test" ? <Spinner small /> : null}
            {busy === "test" ? "Testing…" : "Test"}
          </button>
          <button type="button" className={buttonClass("gray", "sm")} disabled={busy !== null || !key.trim()} onClick={() => void run("save")}>
            {busy === "save" ? <Spinner small /> : null}
            Save key
          </button>
          <span className="text-xs text-muted">One tiny call: the model list, then a one-token answer.</span>
        </div>
        {result ? (
          <p role="status" className="mt-2">
            <Badge tone={LEVEL_TONE[result.level] ?? "info"}>{result.message}</Badge>
          </p>
        ) : null}
        {saved ? <p className="mt-2 text-xs text-ink">{saved}</p> : null}
        {error ? <p className="mt-2 text-xs text-bad">{error}</p> : null}
      </details>
      <MarkForm name={f.name} slug={f.slug} kind={/search|email|verif|scrap|enrich|text/i.test(`${f.name} ${f.free}`) && !f.endpoint.includes("/v1") ? "tool" : "model"} url={get} free={f.free} onDone={onDone} />
    </li>
  );
}

function DecidedRow({ v, onDone }: { v: Verdict; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="py-2.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold text-ink">{v.name}</span>
        <Badge tone={v.verdict === "usable" ? "good" : "muted"}>{v.verdict === "usable" ? (v.status ?? "usable") : "unusable"}</Badge>
        <span className="text-xs text-muted">
          {v.decided_at.slice(0, 10)} · {v.by}
        </span>
        <button type="button" className="text-xs text-accent underline" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
          {editing ? "Close" : "Change"}
        </button>
      </div>
      {v.note ? <p className="mt-0.5 text-xs break-words text-muted">{v.note}</p> : null}
      {editing ? (
        <MarkForm name={v.name} slug={v.slug} kind={v.kind} url={v.url} free={v.free} note={v.note} onDone={() => { setEditing(false); onDone(); }} />
      ) : null}
    </li>
  );
}

export default function FindsView() {
  const { data, error, reload } = usePoll<Data>("provider-finds", 5 * 60_000);
  const load = reload;
  if (!data) return error ? <p className="text-sm text-bad">{error}</p> : <Spinner />;
  const usable = data.decided.filter((v) => v.verdict === "usable").length;
  return (
    <div className="space-y-5">
      <Panel title={`New finds (${data.finds.length})`} hint="Free APIs the Scout found that you have not marked yet. Get a key, test it, then mark it: usable ones go on the blog's free-API list with your note, unusable ones on its not-free list, at the next blog build.">
        {data.finds.length ? (
          <ul className="divide-y divide-line">
            {data.finds.map((f) => (
              <FindCard key={f.slug} f={f} onDone={() => void load()} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing new: every find is marked. The Scout&apos;s next find shows here.</p>
        )}
      </Panel>
      <Panel title="Your marks" aside={`${usable} usable · ${data.decided.length - usable} unusable`} hint="What the blog's /free-ai-apis page shows. Change one to move it between the lists or reword its note.">
        <ul className="divide-y divide-line">
          {data.decided.map((v) => (
            <DecidedRow key={`${v.slug}-${v.name}`} v={v} onDone={() => void load()} />
          ))}
        </ul>
      </Panel>
    </div>
  );
}
