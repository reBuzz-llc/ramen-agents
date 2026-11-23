"use client";
import { useState } from "react";
import type { Answers } from "@/lib/family";

type Field = { key: keyof Answers; label: string; hint?: string; required?: boolean; long?: boolean };

const FIELDS: Field[] = [
  { key: "name", label: "Your company's name", required: true },
  { key: "sells", label: "What you sell, in one line", hint: "e.g. websites and online booking for small shops", required: true },
  { key: "buyers", label: "Who buys it", hint: "e.g. restaurants, salons and clinics", required: true },
  { key: "place", label: "Where your customers are", hint: "a city, a region or a country", required: true },
  { key: "segment", label: "What kind of businesses, in two or three words", hint: "e.g. small businesses" },
  { key: "trades", label: "Their trades, comma-separated", hint: "e.g. restaurants, shops, clinics (empty: the same as who buys it)" },
  { key: "owner", label: "Your name, as first emails are signed" },
  { key: "signoff", label: "How first emails end", hint: "empty: Regards, your name, -- your company", long: true },
  { key: "domains", label: "Your own website's domain(s), comma-separated", hint: "so no agent lists your own site as a lead" },
  { key: "teammate", label: "Who on your team sends the emails", hint: "a first name (empty: you)" },
  { key: "steer", label: "Your direction for the agents, in one sentence", hint: "optional", long: true },
];

const input = "mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";

export default function SetupForm({ initial }: { initial: Answers }) {
  const [a, setA] = useState<Answers>(initial);
  const [state, setState] = useState<{ kind: "idle" | "saving" | "saved" | "error"; text?: string }>({ kind: "idle" });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "saving" });
    try {
      const res = await fetch("/api/family", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(a) });
      const body = (await res.json()) as { answers?: Answers; error?: string };
      if (!res.ok || !body.answers) throw new Error(body.error ?? `HTTP ${res.status}`);
      setA(body.answers);
      setState({ kind: "saved" });
    } catch (err) {
      setState({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <form onSubmit={save} className="mt-6 space-y-4">
      {FIELDS.map((f) => (
        <label key={f.key} className="block">
          <span className="text-sm font-medium text-ink">
            {f.label}
            {f.required ? <span className="text-muted"> (needed)</span> : null}
          </span>
          {f.long ? (
            <textarea rows={3} className={input} value={a[f.key]} placeholder={f.hint} onChange={(e) => setA({ ...a, [f.key]: e.target.value })} />
          ) : (
            <input className={input} value={a[f.key]} placeholder={f.hint} required={f.required} onChange={(e) => setA({ ...a, [f.key]: e.target.value })} />
          )}
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button type="submit" disabled={state.kind === "saving"} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {state.kind === "saving" ? "Saving…" : "Save"}
        </button>
        {state.kind === "saved" ? (
          <span className="text-sm text-ink" role="status">
            Saved. The agents read it on their next cycle. Not started yet? Run <code className="font-mono text-xs">sh scripts/setup.sh --answers common-data/local/family.toml</code>.
          </span>
        ) : null}
        {state.kind === "error" ? (
          <span className="text-sm text-ink" role="alert">
            Not saved: {state.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
