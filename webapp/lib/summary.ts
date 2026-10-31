// Two small helpers for the bots' own databases: local time as the bots write it, and a quoted SQL string.
/** Local time as the bots write it: 2026-09-15T10:42:28. */
export function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
export const sq = (s: string) => `'${s.replace(/'/g, "''")}'`;
