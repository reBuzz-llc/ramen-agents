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

export const errorText = (err: unknown) => (err instanceof Error ? err.message : "request failed");
