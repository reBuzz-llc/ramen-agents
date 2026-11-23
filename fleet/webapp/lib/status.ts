export type Tone = "good" | "warn" | "bad" | "info" | "muted";

export const TONE_TEXT: Record<Tone, string> = {
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  info: "text-info",
  muted: "text-muted",
};
// Dots and fills use the default system colors; text uses the contrast-safe variants above (see globals.css).
export const TONE_DOT: Record<Tone, string> = {
  good: "bg-sys-green",
  warn: "bg-sys-orange",
  bad: "bg-sys-red",
  info: "bg-sys-blue",
  muted: "bg-sys-gray",
};
export const TONE_FILL: Record<Tone, string> = {
  good: "bg-sys-green/15",
  warn: "bg-sys-orange/15",
  bad: "bg-sys-red/12",
  info: "bg-sys-blue/12",
  muted: "bg-fill-3",
};

/** Short status for a bot in the switcher, from the summary /api/bots returns. */
export function summaryStatus(b: import("./bot").BotSummary): { label: string; tone: Tone } {
  if (!b.online) return { label: "data server offline", tone: "muted" };
  if (!b.running) return b.flags.includes("STOP") ? { label: "stopped", tone: "muted" } : { label: "not running", tone: "bad" };
  if (b.flags.includes("PAUSE")) return { label: "paused", tone: "warn" };
  // A hold from The CEO: say who and until when, so it doesn't read as broken.
  if (b.hold) {
    const t = new Date(b.hold.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return { label: `${b.hold.mode === "pause" ? "paused" : "slowed"} by ${b.hold.by} until ${t}${b.hold.why ? ` (${b.hold.why})` : ""}`, tone: "warn" };
  }
  if (b.status === "paused") return { label: "paused", tone: "warn" };
  if (b.stale) return { label: "possibly stuck", tone: "bad" };
  switch (b.status) {
    case "running":
      return { label: "exploring", tone: "good" };
    case "quiet":
      return { label: "quiet mode", tone: "info" };
    case "starting":
      return { label: "starting", tone: "info" };
    case "exiting":
      return { label: "shutting down", tone: "warn" };
    default:
      return { label: b.status ?? "unknown", tone: "muted" };
  }
}
