"use client";
// Each key in Key providers -> All keys (owner, 2026-11-12): Test (the saved key, one tiny call) and Usable / Unusable with
// a note, the same marks as the Finds tab (common-data/provider-verdicts.json; the blog's /free-ai-apis page shows them).
import { createContext, useContext, useState } from "react";
import { sendJson } from "@/lib/client";
import type { TestResult } from "@/lib/keys";
import type { Verdict } from "@/lib/provider-finds";
import { Badge, buttonClass, Spinner } from "../../ui";

const LEVEL_TONE = { works: "good", valid: "info", "no-quota": "warn", rejected: "bad", error: "bad" } as const;
const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");

export const MarksContext = createContext<{ marks: Verdict[]; reload: () => void; tested?: () => void }>({ marks: [], reload: () => {} });

/** The owner's mark for a key, matched by key name or name (as the Finds tab matches). */
export function markFor(name: string, marks: Verdict[]): Verdict | null {
  const k = norm(name);
  return marks.find((v) => norm(v.slug) === k || norm(v.name) === k) ?? null;
}

export default function KeyRowActions({ name, kind }: { name: string; kind: string }) {
  const { marks, reload, tested } = useContext(MarksContext);
  const mark = markFor(name, marks);
  const [busy, setBusy] = useState<"test" | "usable" | "unusable" | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [asking, setAsking] = useState<"usable" | "unusable" | null>(null);
  const [note, setNote] = useState(mark?.note ?? "");
  const [error, setError] = useState("");
  const test = async () => {
    setBusy("test");
    setError("");
    const sent = await sendJson<TestResult & { error?: string }>("/api/key-test", "POST", { name });
    if (sent.body?.level) {
      setResult(sent.body);
      tested?.();
    }
    else setError(sent.body?.error ?? sent.error ?? "the test did not run");
    setBusy(null);
  };
  const save = async (verdict: "usable" | "unusable") => {
    setBusy(verdict);
    setError("");
    const sent = await sendJson<{ ok?: boolean; error?: string }>("/api/provider-finds", "POST", {
      action: "mark", name: mark?.name ?? name, slug: mark?.slug ?? name, verdict, note, kind: mark?.kind ?? (/model/i.test(kind) ? "model" : "tool"),
    });
    setBusy(null);
    if (sent.ok && sent.body?.ok) {
      setAsking(null);
      reload();
    } else setError(sent.body?.error ?? sent.error ?? "could not save");
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      {/model/i.test(kind) ? (
        <button type="button" className={buttonClass("tinted", "sm")} disabled={busy !== null} onClick={() => void test()}>
          {busy === "test" ? <Spinner small /> : null}
          {busy === "test" ? "Testing…" : "Test"}
        </button>
      ) : null}
      <button type="button" className={buttonClass(mark?.verdict === "usable" ? "prominent" : "gray", "sm")} disabled={busy !== null} onClick={() => setAsking(asking === "usable" ? null : "usable")} aria-pressed={mark?.verdict === "usable"}>
        Usable
      </button>
      <button type="button" className={buttonClass(mark?.verdict === "unusable" ? "prominent" : "gray", "sm")} disabled={busy !== null} onClick={() => setAsking(asking === "unusable" ? null : "unusable")} aria-pressed={mark?.verdict === "unusable"}>
        Unusable
      </button>
      {mark ? (
        <span className="min-w-0 text-muted">
          Marked {mark.verdict} {mark.decided_at.slice(5, 10)}
          {mark.note ? `: ${mark.note}` : ""}
        </span>
      ) : (
        <span className="text-muted">Not marked yet</span>
      )}
      {result ? <Badge tone={LEVEL_TONE[result.level] ?? "info"}>{result.message}</Badge> : null}
      {asking ? (
        <span className="flex w-full flex-wrap items-center gap-2">
          <input
            className="h-7 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 text-xs text-ink"
            placeholder={`Why ${asking}? (on the blog page)`}
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
          <button type="button" className={buttonClass("prominent", "sm")} disabled={busy !== null || !note.trim()} onClick={() => void save(asking)}>
            {busy === asking ? <Spinner small /> : null}
            Save as {asking}
          </button>
        </span>
      ) : null}
      {error ? <span className="w-full text-bad">{error}</span> : null}
    </div>
  );
}
