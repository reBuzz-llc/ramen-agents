"use client";

import { useEffect, useState } from "react";
import { OFF_WORDS, offReason, type OffReason } from "@/lib/world-off";

const WAIT_MS = 10_000;

/** The live world: the Mac's read-only world in a frame. Shown once the world says it is ready (it
 *  posts "peek-world-ready" with its height); after ten seconds without that, the fallback line, which says why: the
 *  relay's /ping tells "the Mac or its tunnel is down" from "this address may not frame it" (lib/world-off.ts). */
export default function LiveWorld({ src }: { src: string }) {
  const origin = new URL(src).origin;
  const [state, setState] = useState<"loading" | "ready" | "off">("loading");
  const [why, setWhy] = useState<OffReason>("down");
  const [height, setHeight] = useState(900);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== origin || (e.data as { type?: string })?.type !== "peek-world-ready") return;
      setState("ready");
      const h = Number((e.data as { height?: number }).height);
      if (Number.isFinite(h) && h > 200) setHeight(Math.min(Math.ceil(h), 4000));
    };
    window.addEventListener("message", onMsg);
    let live = true;
    const t = setTimeout(async () => {
      const ping = await fetch(`${origin}/ping`, { cache: "no-store", signal: AbortSignal.timeout(5_000) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!live) return;
      setWhy(offReason(ping, window.location.origin));
      setState((s) => (s === "loading" ? "off" : s));
    }, WAIT_MS);
    return () => {
      live = false;
      window.removeEventListener("message", onMsg);
      clearTimeout(t);
    };
  }, [origin]);
  return (
    <section aria-labelledby="live-world" className="mt-6">
      <h2 id="live-world" className="sr-only">
        The Team, live
      </h2>
      {state === "off" ? (
        <p data-world="off" data-world-why={why} className="rounded-lg bg-panel p-4 text-sm text-muted">
          {OFF_WORDS[why]}
        </p>
      ) : (
        <>
          {state === "loading" ? <p className="text-sm text-muted">Opening the live world…</p> : null}
          <iframe
            data-world={state}
            title="The agents, live"
            src={src}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-downloads"
            allow="autoplay"
            className={`block w-full rounded-xl border border-line ${state === "ready" ? "" : "h-0 opacity-0"}`}
            style={state === "ready" ? { height } : undefined}
          />
        </>
      )}
    </section>
  );
}
