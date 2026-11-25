"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { asksForOwner, BenchView } from "@/lib/owner-asks";

type Ask = Awaited<ReturnType<typeof asksForOwner>>[number];
const PLACE: Record<string, string> = { "profile-post": "a post on the LinkedIn profile", "profile-headline": "the LinkedIn profile headline", "profile-about": "the LinkedIn profile About section" };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const stateOf = (a: Ask) => (a.usedAt ? `Posted ${when(a.usedAt)}` : a.byOwner ? `Approved by ${a.person} ${when(a.at!)}` : a.withdrawn ? `Withdrawn ${when(a.withdrawnAt!)}` : a.at ? "Approved by someone who is no longer an owner: not valid" : "Waiting for you");
const btn = "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold disabled:opacity-50";

export default function ApprovalsView({ asks, benches, focusAsk, focusBench }: { asks: Ask[]; benches: BenchView[]; focusAsk: string; focusBench: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    document.querySelector("[data-focus]")?.scrollIntoView({ block: "center" });
  }, []);
  const press = async (id: string, body: object, done: string) => {
    setBusy(id);
    setNote("");
    const r = (await fetch("/api/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "No answer from the server." }))) as { ok: boolean; error?: string };
    setBusy("");
    setNote(r.ok ? done : (r.error ?? "That failed."));
    router.refresh();
  };
  return (
    <div className="mt-6 space-y-8">
      {note ? <p role="status" className="text-sm font-medium">{note}</p> : null}
      <section aria-labelledby="posts">
        <h2 id="posts" className="text-lg font-semibold">LinkedIn</h2>
        {asks.length === 0 ? <p className="mt-2 rounded-xl border border-line bg-panel p-4 text-sm text-muted">Nothing is waiting for your approval.</p> : null}
        <ul className="mt-3 space-y-3">
          {asks.map((a) => (
            <li key={a.id} data-ask={a.subject} data-focus={a.subject === focusAsk || undefined} className={`rounded-xl border bg-panel p-4 text-sm ${a.subject === focusAsk ? "border-accent" : "border-line"}`}>
              <p className="font-semibold">{a.title}</p>
              <p className="mt-0.5 text-xs text-muted">Goes to {PLACE[a.target] ?? a.target} · filed {when(a.filedAt)}</p>
              <pre data-words className="mt-2 max-h-96 overflow-auto rounded-lg border border-line bg-bg p-3 font-sans text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">{a.text}</pre>
              <p data-state className="mt-2 font-medium">{stateOf(a)}</p>
              {!a.usedAt ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {a.byOwner ? (
                    <button type="button" disabled={busy === a.id} onClick={() => void press(a.id, { action: "withdraw" }, "Approval withdrawn.")} className={`${btn} border border-line hover:border-accent`}>Withdraw</button>
                  ) : (
                    <button type="button" disabled={busy === a.id} onClick={() => void press(a.id, { action: "approve", textHash: a.textHash }, "Approved: these exact words can go out once.")} className={`${btn} bg-accent text-on-accent hover:bg-accent-hover`}>Approve</button>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="benches">
        <h2 id="benches" className="text-lg font-semibold">Billing benches</h2>
        <p className="mt-1 text-sm text-muted">A provider stays off until you say it is still free. To keep it benched, do nothing.</p>
        {benches.length === 0 ? <p className="mt-2 rounded-xl border border-line bg-panel p-4 text-sm text-muted">No provider is benched.</p> : null}
        <ul className="mt-3 space-y-3">
          {benches.map((b) => (
            <li key={b.id} data-bench={b.itemId} data-focus={b.itemId === focusBench || undefined} className={`rounded-xl border bg-panel p-4 text-sm ${b.itemId === focusBench ? "border-accent" : "border-line"}`}>
              <p className="font-semibold">{b.host}</p>
              <p className="mt-1 [overflow-wrap:anywhere]">{b.why}</p>
              <p className="mt-1 text-xs text-muted">Benched {when(b.at)}</p>
              {b.cleared ? (
                <p data-state className="mt-2 font-medium">{b.byOwner ? `Still free: cleared by ${b.person} ${when(b.clearedAt!)}` : "Cleared by someone who is no longer an owner: not valid"}</p>
              ) : (
                <button type="button" disabled={busy === b.id} onClick={() => void press(b.id, { action: "clear" }, `${b.host}: cleared, it can be used again.`)} className={`${btn} mt-2 bg-accent text-on-accent hover:bg-accent-hover`}>Still free: use it again</button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
