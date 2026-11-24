"use client";
// Settings -> Providers -> All providers: every provider ramen-agents knows (common-data/providers.json), grouped by how it
// stands, each with Add key, Test, Delete and the person's own mark. An unusable or set-aside provider shows its reason and
// date first; its key goes in only after "Add a key anyway". Keys never come back to this page.
import { useState } from "react";
import { sendJson } from "@/lib/client";
import { GROUPS, markLine, needsConfirm, type TestOutcome } from "@/lib/providers-list";
import type { ProviderRow } from "@/lib/providers-store";
import { usePoll } from "../../hooks";
import { Badge, buttonClass, Spinner } from "../../ui";

const LEVEL_TONE = { works: "good", rejected: "bad", "no-quota": "warn", untested: "info" } as const;
const USE_WORD: Record<string, string> = { model: "AI model", "email-check": "Email check", search: "Search", tool: "Tool", board: "Board" };

export default function AllProvidersView() {
  const { data, error, reload } = usePoll<{ rows: ProviderRow[]; skipped: string[] }>("settings/provider-list", 5 * 60_000);
  const load = async () => reload();
  if (error && !data) return <p className="text-sm text-bad">The list could not be read: {error}</p>;
  if (!data) return <Spinner />;
  return (
    <div data-all-providers>
      <p className="mb-4 text-sm text-muted">
        Every provider ramen-agents knows, from common-data/providers.json. Keys stay in common-data/keys on this Mac and are
        never shown here. A test is a free read (a models list or the account), so it cannot bill.
      </p>
      {data.skipped.length ? <p className="mb-3 text-xs text-sys-orange">Not shown, malformed in providers.json: {data.skipped.join(", ")}</p> : null}
      {GROUPS.map((g) => {
        const rows = data.rows.filter((r) => r.group === g.key);
        if (!rows.length) return null;
        return (
          <section key={g.key} className="mt-6 first:mt-0" data-group={g.key}>
            <h3 className="flex items-baseline gap-2 text-sm font-semibold text-ink">
              {g.title} <span className="text-xs font-normal text-muted tabular-nums">{rows.length}</span>
            </h3>
            <p className="text-xs text-muted">{g.line}</p>
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {rows.map((r) => (
                <ProviderItem key={r.name} row={r} reload={load} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ProviderItem({ row, reload }: { row: ProviderRow; reload: () => Promise<void> }) {
  const marked = needsConfirm(row);
  const [open, setOpen] = useState<"" | "key" | "delete" | "mark">("");
  const [anyway, setAnyway] = useState(false);
  const [key, setKey] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [note, setNote] = useState(row.own?.note ?? "");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<TestOutcome | null>(null);
  const [message, setMessage] = useState("");
  const post = async (payload: Record<string, unknown>) => {
    const sent = await sendJson<{ ok?: boolean; error?: string; kept?: string } & Partial<TestOutcome>>("/api/settings/provider-list", "POST", { name: row.name, ...payload });
    return sent.body ?? { error: sent.error ?? "no answer" };
  };
  const test = async () => {
    setBusy("test");
    const r = await post({ action: "test" });
    if (r.level) setResult(r as TestOutcome);
    else setMessage(r.error ?? "the test did not run");
    setBusy("");
  };
  const save = async () => {
    setBusy("save");
    setMessage("");
    const r = await post({ action: "save", key, confirm: marked ? true : undefined });
    setKey("");
    setBusy("");
    if (!r.ok) return setMessage(r.error ?? "could not save");
    setOpen("");
    await reload();
    await test();
  };
  const remove = async () => {
    setBusy("delete");
    const r = await post({ action: "delete", confirm: confirmName });
    setBusy("");
    setConfirmName("");
    if (!r.ok) return setMessage(r.error ?? "could not delete");
    setOpen("");
    setResult(null);
    setMessage(`Key moved to ${r.kept}: put it back there by hand if you need it.`);
    await reload();
  };
  const mark = async (m: "unusable" | "needs-billing" | "clear") => {
    setBusy("mark");
    const r = await post({ action: "mark", mark: m, note });
    setBusy("");
    if (!r.ok) return setMessage(r.error ?? "could not save the mark");
    setOpen("");
    await reload();
  };
  const terms = row.name === "gemini";
  return (
    <li className="px-3 py-2.5 text-sm" data-provider={row.name}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-ink">{row.who}</span>
        <span className="text-xs text-muted">{USE_WORD[row.use] ?? row.use}</span>
        {row.hasKey ? <Badge tone={row.keyOpen ? "warn" : "good"}>{row.keyOpen ? "key on file, readable by others: chmod 600" : "key on file"}</Badge> : null}
        {row.own ? <Badge tone="warn">your mark: {row.own.mark === "needs-billing" ? "needs billing" : "unusable"}</Badge> : null}
        {row.where ? (
          <a className="ml-auto text-xs text-accent-ink hover:underline" href={row.where} target="_blank" rel="noreferrer noopener">
            {new URL(row.where).hostname}
          </a>
        ) : null}
      </div>
      <p className="mt-0.5 text-xs text-ink/85" data-mark-line>{markLine(row)}</p>
      <p className="text-xs text-muted">
        {row.free ? "" : "Needs a card or payment. "}
        {row.card}
      </p>
      {row.usedBy.length ? <p className="text-xs text-muted">Used by {row.usedBy.join(", ")}.</p> : null}
      {row.own?.note ? <p className="text-xs text-muted">Your note ({row.own.at}): {row.own.note}</p> : null}

      {row.status === "removed" ? null : (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          {terms ? (
            <span className="text-muted">Add this key in a terminal: sh scripts/add-key.sh gemini (it shows Google&apos;s terms first).</span>
          ) : marked && !anyway ? (
            <button type="button" className={buttonClass("plain", "sm")} onClick={() => setAnyway(true)} data-add-anyway>
              Add a key anyway
            </button>
          ) : (
            <button type="button" className={buttonClass(row.hasKey ? "gray" : "tinted", "sm")} onClick={() => setOpen(open === "key" ? "" : "key")} data-add-key>
              {row.hasKey ? "Replace key" : "Add key"}
            </button>
          )}
          {row.hasKey ? (
            <>
              <button type="button" className={buttonClass("gray", "sm")} disabled={busy !== ""} onClick={() => void test()}>
                {busy === "test" ? <Spinner small /> : null}
                {busy === "test" ? "Testing…" : "Test"}
              </button>
              <button type="button" className={buttonClass("gray", "sm")} onClick={() => setOpen(open === "delete" ? "" : "delete")}>
                Delete key
              </button>
            </>
          ) : null}
          <button type="button" className={buttonClass("plain", "sm")} onClick={() => setOpen(open === "mark" ? "" : "mark")}>
            {row.own ? "Change your mark" : "Mark it"}
          </button>
          {!row.free && !terms && (!marked || anyway) ? <span className="text-muted">needs a card</span> : null}
          {result ? <Badge tone={LEVEL_TONE[result.level]}>{result.message}</Badge> : null}
        </div>
      )}

      {open === "key" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {marked ? <p className="w-full text-xs text-sys-orange">{markLine(row)} Add a key only if you have checked it yourself.</p> : null}
          <input
            type="password"
            autoComplete="off"
            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 text-xs text-ink"
            placeholder={`Paste your ${row.who} key (never shown again)`}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-label={`${row.who} key`}
          />
          <button type="button" className={buttonClass("prominent", "sm")} disabled={busy !== "" || !key.trim()} onClick={() => void save()}>
            {busy === "save" ? <Spinner small /> : null}
            Save and test
          </button>
          {row.where ? <span className="w-full text-xs text-muted">You make the key yourself, at {row.where}. Nothing here signs you up.</span> : null}
        </div>
      ) : null}

      {open === "delete" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 text-xs text-ink"
            placeholder={`Type ${row.name} to move its key to common-data/keys/deleted/`}
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            aria-label={`Type ${row.name} to delete its key`}
          />
          <button type="button" className={buttonClass("destructive", "sm")} disabled={busy !== "" || confirmName !== row.name} onClick={() => void remove()}>
            Delete key
          </button>
        </div>
      ) : null}

      {open === "mark" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 text-xs text-ink"
            placeholder="Why? (kept on this Mac only)"
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="button" className={buttonClass("gray", "sm")} disabled={busy !== ""} onClick={() => void mark("unusable")}>
            Unusable
          </button>
          <button type="button" className={buttonClass("gray", "sm")} disabled={busy !== ""} onClick={() => void mark("needs-billing")}>
            Needs billing
          </button>
          {row.own ? (
            <button type="button" className={buttonClass("plain", "sm")} disabled={busy !== ""} onClick={() => void mark("clear")}>
              Clear my mark
            </button>
          ) : null}
        </div>
      ) : null}
      {message ? <p className="mt-1 text-xs text-muted">{message}</p> : null}
    </li>
  );
}
