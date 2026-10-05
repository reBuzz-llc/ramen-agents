"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { BotProfile } from "@/lib/bot";
import type { ProviderCatalog, ProviderInfo, TestResult } from "@/lib/keys";
import { sendJson } from "@/lib/client";
import CopyButton from "../../copy-button";
import Sheet from "../../sheet";
import { Badge, buttonClass, Panel, Spinner } from "../../ui";

type RowState = { testing?: boolean; result?: TestResult };

const LEVEL_TONE = { works: "good", valid: "info", "no-quota": "warn", rejected: "bad", error: "bad" } as const;
const TERMINAL = `read -rs KEY && umask 077 && printf '%s' "$KEY" > ~/bots/common-data/keys/NAME.key && unset KEY`;

function usageText(p: ProviderInfo): string | null {
  const u = Object.entries(p.usage ?? {});
  if (!p.usage) return null;
  // The ledger is per provider, shared by every bot (not this bot's own); some providers log calls without tokens.
  if (!u.length) return "All bots today: no token use recorded (calls are on the Overview)";
  const calls = u.reduce((a, [, v]) => a + v.calls, 0);
  const tokens = u.reduce((a, [, v]) => a + v.tokens, 0);
  return `All bots today: ${calls} call${calls === 1 ? "" : "s"}, ${tokens.toLocaleString()} tokens`;
}

export default function ProvidersView({ bots, initial }: { bots: BotProfile[]; initial: string }) {
  const [slug, setSlug] = useState(initial);
  const [cat, setCat] = useState<ProviderCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [editing, setEditing] = useState<ProviderInfo | null>(null);
  const bot = bots.find((b) => b.slug === slug) ?? bots[0];

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/settings/providers?bot=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
      else {
        setCat(body as ProviderCatalog);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    }
  }, [slug]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const test = async (p: ProviderInfo) => {
    setRows((r) => ({ ...r, [p.name]: { testing: true } }));
    const sent = await sendJson<TestResult & { error?: string }>("/api/settings/keys", "POST", { bot: slug, name: p.name });
    const result: TestResult = sent.body?.level ? sent.body : { ok: false, level: "error", message: sent.body?.error ?? sent.error ?? "test failed" };
    setRows((r) => ({ ...r, [p.name]: { result } }));
  };

  const local = cat && cat.chain.length === 0;
  const withKey = cat?.chain.filter((p) => p.hasKey).length ?? 0;

  const row = (p: ProviderInfo, inChain: boolean) => {
    const st = rows[p.name] ?? {};
    return (
      <li key={p.name} className="flex gap-3 py-3">
        {inChain ? (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-fill-3 font-rounded text-sm font-bold text-ink tabular-nums">{p.position}</span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{p.name}</span>
            <Badge tone={p.hasKey ? "good" : inChain ? "bad" : "muted"}>{p.hasKey ? "Key saved" : "No key"}</Badge>
            {p.auto && inChain ? <Badge tone="info">Added automatically</Badge> : null}
          </div>
          <p className="mt-0.5 font-mono text-xs break-all text-ink/85">{p.model}</p>
          <p className="mt-0.5 text-xs text-muted">{p.note}</p>
          {inChain && usageText(p) ? <p className="mt-0.5 text-xs text-muted">{usageText(p)}</p> : null}
          {!inChain && !p.auto ? <p className="mt-0.5 text-xs text-muted">Not added automatically: list it in provider_chain to use it.</p> : null}
          {st.result ? (
            <p role="status" className="mt-2">
              <Badge tone={LEVEL_TONE[st.result.level]}>{st.result.message}</Badge>
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
          {p.hasKey ? (
            <button type="button" onClick={() => void test(p)} disabled={st.testing} className={buttonClass("tinted", "sm")}>
              {st.testing ? <Spinner small /> : null}
              {st.testing ? "Testing…" : "Test"}
            </button>
          ) : null}
          <button type="button" onClick={() => setEditing(p)} className={buttonClass(p.hasKey ? "gray" : "prominent", "sm")}>
            {p.hasKey ? "Replace" : "Add key"}
          </button>
        </div>
      </li>
    );
  };

  return (
    <>
      <nav aria-label="Bot" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {bots.map((b) => (
          <Link
            key={b.slug}
            href={`/settings/providers?bot=${b.slug}`}
            onClick={() => {
              setSlug(b.slug);
              setCat(null);
              setRows({});
            }}
            aria-current={b.slug === slug ? "page" : undefined}
            className={`pressable shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${b.slug === slug ? "bg-sys-blue text-white" : "bg-panel text-ink hover:bg-fill-3"}`}
          >
            {b.name}
          </Link>
        ))}
      </nav>

      {error ? <p className="rounded-xl bg-sys-red/10 p-4 text-sm text-bad">Could not read the providers: {error}</p> : null}
      {!cat && !error ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Reading {bot?.name}&apos;s providers…
        </p>
      ) : null}

      {cat ? (
        <>
          <Panel
            title="Model chain"
            aside={local ? `local model: ${cat.fallback}` : `${withKey} of ${cat.chain.length} with a key`}
            hint={local ? undefined : "Tried in this order. A provider that is rate-limited, capped, out of credit or down is skipped until it recovers."}
          >
            {local ? (
              <p className="text-sm text-muted">{bot?.name} runs only on its local model, so it uses no provider keys.</p>
            ) : (
              <ol className="divide-y divide-line">{cat.chain.map((p) => row(p, true))}</ol>
            )}
          </Panel>
          {cat.known.length ? (
            <Panel title={local ? "Keys on this Mac" : "More providers"} hint={local ? "Shared by every bot that uses remote models." : "Save a key for a provider marked free, and bots add it to the end of the chain on their next start."}>
              <ul className="divide-y divide-line">{cat.known.map((p) => row(p, false))}</ul>
            </Panel>
          ) : null}
        </>
      ) : null}

      <p className="text-xs text-muted">
        Keys are stored only in <code className="font-mono">~/bots/common-data/keys</code> (readable only by you). This page never shows a
        saved key. Bots read keys when they start, so restart a bot after changing one.
      </p>

      <KeySheet provider={editing} slug={slug} onClose={() => setEditing(null)} onSaved={() => void load()} />
    </>
  );
}

function KeySheet({ provider, slug, onClose, onSaved }: { provider: ProviderInfo | null; slug: string; onClose: () => void; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const close = () => {
    setKey("");
    setResult(null);
    setSaved(null);
    setFailure(null);
    onClose();
  };

  if (!provider) return <Sheet open={false} onClose={close} title="">{null}</Sheet>;

  const run = async (what: "test" | "save") => {
    setBusy(what);
    setFailure(null);
    if (what === "test") {
      const sent = await sendJson<TestResult & { error?: string }>("/api/settings/keys", "POST", { bot: slug, name: provider.name, key });
      setResult(sent.body?.level ? sent.body : { ok: false, level: "error", message: sent.body?.error ?? sent.error ?? "test failed" });
    } else {
      const sent = await sendJson<{ ok?: boolean; ending?: string; error?: string }>("/api/settings/keys", "PUT", { bot: slug, name: provider.name, key });
      if (sent.ok && sent.body?.ok) {
        setSaved(`Saved the key ending in ${sent.body.ending}. Restart bots that use ${provider.name} so they read it.`);
        setKey("");
        onSaved();
      } else setFailure(sent.body?.error ?? sent.error ?? "could not save");
    }
    setBusy(null);
  };

  const looksValid = /^[\x21-\x7e]{16,512}$/.test(key.trim());

  return (
    <Sheet open onClose={close} title={`${provider.hasKey ? "Replace" : "Add"} ${provider.name} key`}>
      <p className="mb-3 text-sm text-muted">{provider.note}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (looksValid && !busy) void run("save");
        }}
      >
        <label className="mb-1.5 block text-xs font-semibold text-muted" htmlFor="api-key">
          API key
        </label>
        <input
          id="api-key"
          type="password"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setResult(null);
            setSaved(null);
          }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="done"
          placeholder="Paste the key"
          className="w-full rounded-lg bg-fill-3 px-3.5 py-2.5 font-mono text-base text-ink placeholder:font-sans placeholder:text-muted focus:ring-2 focus:ring-sys-blue/40 focus:outline-none"
          autoFocus
        />
        {result ? (
          <p role="status" className="mt-2.5">
            <Badge tone={LEVEL_TONE[result.level]}>{result.message}</Badge>
          </p>
        ) : null}
        {saved ? <p role="status" className="mt-2.5 rounded-lg bg-sys-green/12 px-3 py-2 text-sm text-ink">{saved}</p> : null}
        {failure ? <p role="alert" className="mt-2.5 rounded-lg bg-sys-red/10 px-3 py-2 text-sm text-bad">{failure}</p> : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={() => void run("test")} disabled={!looksValid || busy !== null} className={buttonClass("gray")}>
            {busy === "test" ? <Spinner /> : null}
            {busy === "test" ? "Testing…" : "Test"}
          </button>
          <button type="submit" disabled={!looksValid || busy !== null} className={buttonClass("prominent")}>
            {busy === "save" ? <Spinner /> : null}
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
      <details className="mt-4 text-xs text-muted">
        <summary className="cursor-pointer select-none">Prefer Terminal?</summary>
        <p className="mt-2">Run this on the Mac with NAME set to {provider.name}, paste the key when it waits, and press Return:</p>
        <span className="mt-1.5 flex items-center gap-2 rounded-lg bg-grouped-3 px-3 py-2">
          <code className="min-w-0 flex-1 overflow-x-auto font-mono whitespace-nowrap">{TERMINAL.replace("NAME", provider.name)}</code>
          <CopyButton text={TERMINAL.replace("NAME", provider.name)} what="command" />
        </span>
      </details>
    </Sheet>
  );
}
