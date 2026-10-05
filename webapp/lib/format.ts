// Small display helpers shared by the dashboard components. Pure functions, safe on server and client.

/** "12s ago", "5m ago", "3h ago", "2d ago"; "–" before the clock is known. */
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso || !now) return "–";
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };

/** 24-hour local time, e.g. "14:03:59". */
export function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], TIME);
}

/** The local time, with the date in front when it is not today. */
export function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], TIME);
  return new Date().toDateString() === d.toDateString() ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

/** A length of time: "45s", "12m", "3h 5m", "2d 4h". */
export function duration(secs: number | null): string {
  if (secs === null) return "–";
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Megabytes as "512 MB" or "1.4 GB". */
export function memory(memMb: number): string {
  return memMb >= 1024 ? `${(memMb / 1024).toFixed(1)} GB` : `${Math.round(memMb)} MB`;
}

export const errorText = (err: unknown) => (err instanceof Error ? err.message : "request failed");
