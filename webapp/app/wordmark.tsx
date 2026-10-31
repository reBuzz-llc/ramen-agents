/** The family's name on screen and the way home: "ramen-agents" with the accent on the hyphen, near-black text, top
 *  left of every page (2026-10-30). A plain <a>, not a client-side Link: going home is a full load,
 *  so it works from any page and from a tab still holding an older build. */
export default function Wordmark({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load on purpose (see above)
    <a
      href="/"
      aria-label="ramen-agents, home"
      className={`glass pressable flex h-11 shrink-0 items-center rounded-full px-4 font-rounded text-base font-bold tracking-tight text-ink ${className}`}
    >
      ramen<span style={{ color: "#ff6600" }}>-</span>agents
    </a>
  );
}
