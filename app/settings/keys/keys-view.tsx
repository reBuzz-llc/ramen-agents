"use client";
// Settings > API keys: make a key (shown once, with a copy button) and revoke one. A name's earlier live key is revoked
// when a new one is made, as scripts/api-key.mjs does, so each agent has one live key.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { btnDanger, btnOutline, control, fieldLabel, helper, sectionTitle } from "@/lib/ui-classes";
import { PendingButton } from "../../ui";

type Scope = { scope: string; label: string };
export type KeyRow = {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** Today's reads through this key: requests, the 304s among them, and the bytes answered. */
  today?: { requests: number; notModified: number; bytes: number } | null;
};
const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

async function call(url: string, init: RequestInit): Promise<{ ok: boolean; error?: string; token?: string; name?: string; revoked?: number }> {
  try {
    return await (await fetch(url, { ...init, headers: { "Content-Type": "application/json" } })).json();
  } catch {
    return { ok: false, error: "No answer from the server; check the connection and try again." };
  }
}

export default function KeysView({ keys, scopes, defaults }: { keys: KeyRow[]; scopes: Scope[]; defaults: Record<string, string[]> }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>(["board:read", "board:write"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [made, setMade] = useState<{ name: string; token: string; revoked: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");
  const live = keys.filter((k) => !k.revokedAt);
  const old = keys.filter((k) => k.revokedAt);

  const onName = (v: string) => {
    setName(v);
    const d = defaults[v.trim().toLowerCase()];
    if (d) setPicked(d);
  };
  const mint = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMade(null);
    const r = await call("/api/keys", { method: "POST", body: JSON.stringify({ name, scopes: picked }) });
    setBusy(false);
    if (!r.ok || !r.token) return setError(r.error ?? "Could not make the key.");
    setMade({ name: r.name ?? name, token: r.token, revoked: r.revoked ?? 0 });
    setCopied(false);
    setName("");
    router.refresh();
  };
  const revoke = async (k: KeyRow) => {
    if (!window.confirm(`Revoke the key "${k.name}"? The agent using it is refused from its next call on.`)) return;
    const r = await call(`/api/keys/${k.id}`, { method: "DELETE" });
    setNote(r.ok ? `"${k.name}" revoked.` : r.error ?? "Could not revoke it.");
    router.refresh();
  };

  return (
    <>
      <section aria-labelledby="mint" className="rounded-2xl bg-panel p-5">
        <h2 id="mint" className={sectionTitle}>
          Make a key
        </h2>
        <p className={helper}>One key per agent, named after it. Making a key for a name that has one replaces the old key.</p>
        <form onSubmit={mint} className="mt-4 space-y-4">
          <label className={`${fieldLabel} sm:max-w-xs`}>
            Name
            <input value={name} onChange={(e) => onName(e.target.value)} required pattern="[a-z][a-z0-9\-]{1,30}" placeholder="engine" autoComplete="off" spellCheck={false} className={control} />
          </label>
          <fieldset>
            <legend className="text-xs font-medium text-muted">What it may do</legend>
            <div className="mt-1 grid gap-x-6 sm:grid-cols-2">
              {scopes.map((s) => (
                <label key={s.scope} className="flex min-h-11 items-center gap-3 text-[0.9375rem]">
                  <input type="checkbox" className="size-5 shrink-0 accent-[var(--color-accent)]" checked={picked.includes(s.scope)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.scope] : picked.filter((x) => x !== s.scope))} />
                  <span>
                    {s.label} <code className="text-xs text-muted">{s.scope}</code>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <PendingButton type="submit" pending={busy} pendingLabel="Making…" disabled={!picked.length} className="text-base">
            Make key
          </PendingButton>
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
        </form>
        {made ? (
          <div role="status" className="mt-5 space-y-3 rounded-xl border border-accent bg-accent-tint p-4">
            <p className="text-[0.9375rem] font-semibold">
              The key for &quot;{made.name}&quot;. Copy it now: it is not shown again.
              {made.revoked ? ` Its earlier key was revoked.` : ""}
            </p>
            <code className="block overflow-x-auto rounded-lg bg-panel p-3 text-sm break-all">{made.token}</code>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={btnOutline}
                onClick={async () => {
                  await navigator.clipboard.writeText(made.token).then(() => setCopied(true), () => setCopied(false));
                }}
              >
                {copied ? "Copied" : "Copy key"}
              </button>
              <button type="button" className={btnOutline} onClick={() => setMade(null)}>
                Done, hide it
              </button>
            </div>
            <p className={helper}>Put it in the agent&apos;s key file, peek-{made.name}.key, readable only by you (chmod 600).</p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="live">
        <h2 id="live" className={sectionTitle}>
          Live keys
        </h2>
        {note ? (
          <p role="status" className="mt-2 text-sm">
            {note}
          </p>
        ) : null}
        {live.length ? (
          <ul className="mt-3 divide-y divide-line rounded-2xl bg-panel">
            {live.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-[0.9375rem] font-semibold">{k.name}</p>
                  <p className="text-sm text-muted">
                    {k.scopes.join(" · ")} · made {day(k.createdAt)} · last used {day(k.lastUsedAt)}
                  </p>
                  {k.today ? (
                    <p className="text-sm text-muted tabular-nums">
                      Today: {k.today.requests} reads, {mb(k.today.bytes)}
                      {k.today.notModified ? ` · ${k.today.notModified} with nothing new` : ""}
                    </p>
                  ) : null}
                </div>
                <button type="button" className={`${btnDanger} ml-auto shrink-0`} onClick={() => void revoke(k)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`${helper} mt-3 rounded-2xl bg-panel p-4`}>No live keys. Your agents cannot reach the board until you make one.</p>
        )}
      </section>

      {old.length ? (
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-muted hover:text-ink">Revoked keys ({old.length})</summary>
          <ul className="mt-2 divide-y divide-line rounded-2xl bg-panel text-sm text-muted">
            {old.map((k) => (
              <li key={k.id} className="p-4">
                {k.name} · {k.scopes.join(" · ")} · made {day(k.createdAt)} · revoked {day(k.revokedAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
