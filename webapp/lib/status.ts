import type { BotState } from "./bot";

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

export function describeStatus(state: BotState | null, offline: boolean): { label: string; detail: string; tone: Tone } {
  if (offline || !state) {
    return { label: "Data server offline", detail: "Start it with the command below.", tone: "bad" };
  }
  const hb = state.heartbeat;
  if (!state.running) {
    return state.flags.includes("STOP")
      ? { label: "Stopped", detail: "The STOP flag is set, so launchd keeps it down.", tone: "muted" }
      : { label: "Not running", detail: "No bot process holds the lock.", tone: "bad" };
  }
  if (state.flags.includes("PAUSE") || hb?.status === "paused") {
    return { label: "Paused", detail: "Waiting for the PAUSE flag to be cleared.", tone: "warn" };
  }
  if (state.stale) {
    return { label: "Possibly stuck", detail: "The heartbeat is older than expected.", tone: "bad" };
  }
  switch (hb?.status) {
    case "quiet":
      return { label: "Quiet mode", detail: hb.next_planned ? `Resting because ${hb.next_planned}.` : "Resting while you use the Mac.", tone: "info" };
    case "running":
      return { label: "Exploring", detail: "Reading the web and taking notes.", tone: "good" };
    case "starting":
      return { label: "Starting", detail: "Loading its memory and browser.", tone: "info" };
    case "exiting":
      return { label: "Shutting down", detail: "Finishing its last cycle.", tone: "warn" };
    default:
      return { label: hb?.status ?? "Unknown", detail: "", tone: "muted" };
  }
}


/** Short status for a bot in the switcher, from the summary /api/bots returns. */
export function summaryStatus(b: import("./bot").BotSummary): { label: string; tone: Tone } {
  if (!b.online) return { label: "data server offline", tone: "muted" };
  if (!b.running) return b.flags.includes("STOP") ? { label: "stopped", tone: "muted" } : { label: "not running", tone: "bad" };
  if (b.flags.includes("PAUSE") || b.status === "paused") return { label: "paused", tone: "warn" };
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
