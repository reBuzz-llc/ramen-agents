// Why the live world did not open (saying the Mac or its tunnel was down was wrong when the relay was up but
// refused to be framed by Peek's new address). After the ten-second wait the Family page asks the relay's GET /ping
// (no link needed; it answers {ok, framers}, the origins its frame rule allows) and says which case it is. Pure, so the
// tests read it; no node imports (the Family page's client component uses it).

export type OffReason = "down" | "refused" | "quiet";

/** `ping`: the relay's answer, or null when it did not answer (a network error, a timeout, or not 200). */
export function offReason(ping: { ok?: unknown; framers?: unknown } | null, myOrigin: string): OffReason {
  if (!ping || ping.ok !== true) return "down";
  const framers = Array.isArray(ping.framers) ? ping.framers.map(String) : [];
  return framers.includes(myOrigin) ? "quiet" : "refused";
}

export const OFF_WORDS: Record<OffReason, string> = {
  down: "The live world is off right now (the Mac or its tunnel is down).",
  refused: "The live world is running, but this Peek address is not allowed to show it yet (the owner adds it to the world's frame setting on the Mac).",
  quiet: "The live world did not open: reload the page to get a fresh link.",
};
