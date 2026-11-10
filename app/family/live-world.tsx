"use client";

import { useEffect, useState } from "react";

const WAIT_MS = 10_000;

/** The live office: the agents' machine's read-only world in a frame. Shown once the world says it is ready (it posts
 *  "world-ready" with its height); after ten seconds without that, the fallback line. */
export default function LiveWorld({ src }: { src: string }) {
  const origin = new URL(src).origin;
  const [state, setState] = useState<"loading" | "ready" | "off">("loading");
  const [height, setHeight] = useState(900);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== origin || (e.data as { type?: string })?.type !== "world-ready") return;
      setState("ready");
      const h = Number((e.data as { height?: number }).height);
      if (Number.isFinite(h) && h > 200) setHeight(Math.min(Math.ceil(h), 4000));
    };
    window.addEventListener("message", onMsg);
    const t = setTimeout(() => setState((s) => (s === "loading" ? "off" : s)), WAIT_MS);
    return () => {
      window.removeEventListener("message", onMsg);
      clearTimeout(t);
    };
  }, [origin]);
  return (
    <section aria-labelledby="live-world" className="mt-6">
      <h2 id="live-world" className="sr-only">
        The family, live
      </h2>
      {state === "off" ? (
        <p data-world="off" className="rounded-lg bg-panel p-4 text-sm text-muted">
          The live office is off right now (the agents&apos; machine or its tunnel is down).
        </p>
      ) : (
        <>
          {state === "loading" ? <p className="text-sm text-muted">Opening the live world…</p> : null}
          <iframe
            data-world={state}
            title="The office, live"
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
