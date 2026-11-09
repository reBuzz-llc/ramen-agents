"use client";
// The member panel's tabs for the public bundle: Feed from /state; no Screen (the world never offers it when READ_ONLY).
import type { BotCard } from "@/lib/board";
import { useWorldState } from "./state";

export function ScreenTab(_p: { slug: string; tick: string; last: BotCard["last"] }) {
  return null;
}

/** Feed: the thinking line on top, then the last 20 actions newest first, refusals dimmed. */
export function FeedTab({ slug }: { slug: string; tick: string }) {
  const f = useWorldState().state?.feeds?.[slug];
  if (!f) return <p className="text-xs">Reading…</p>;
  return (
    <div className="space-y-2 font-sans">
      {f.thought ? (
        <p className="text-sm">
          <span className="font-semibold">Thinking:</span> {f.thought}
        </p>
      ) : null}
      <ol className="divide-y divide-black/10">
        {f.feed.map((x, i) => (
          <li key={`${x.ts}-${i}`} className={`flex gap-2 py-1.5 text-xs ${x.verdict === "allowed" ? "" : "opacity-55"}`} title={x.reason || undefined}>
            <span className="w-10 shrink-0 tabular-nums opacity-70">{x.ts.slice(11, 16)}</span>
            <span className="min-w-0 flex-1 break-words">{x.words}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
