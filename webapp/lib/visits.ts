// Server-side only: the pages a bot opened, read from its own database (read-only, as lib/episodes.ts).
// The dashboard's "Pages visited" count links to a page built on this.
import type { BotProfile } from "./bot";
import { dbPath, query } from "./episodes";

export const PAGE_SIZE = 100;

export type Visit = { id: number; at: string; url: string; domain: string; title: string; ok: boolean; error: string | null };
export type VisitPage = {
  total: number;
  shown: number;
  offset: number;
  /** Every domain with a count, so the page can offer them as a filter. */
  domains: { domain: string; pages: number }[];
  visits: Visit[];
};

const num = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const sq = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function readVisits(
  bot: BotProfile,
  opts: { offset?: number; domain?: string; q?: string; failed?: boolean } = {},
): Promise<VisitPage> {
  const db = await dbPath(bot);
  const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
  const where: string[] = [];
  if (opts.domain) where.push(`domain = ${sq(opts.domain)}`);
  if (opts.failed) where.push("ok = 0");
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
    where.push(`(url LIKE ${sq(like)} ESCAPE '\\' OR coalesce(title, '') LIKE ${sq(like)} ESCAPE '\\')`);
  }
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [counted, rows, domains] = await Promise.all([
    query(db, `SELECT COUNT(*) AS n FROM visits ${filter}`),
    query(
      db,
      `SELECT id, visited_at, url, domain, coalesce(title, '') AS title, ok, coalesce(error, '') AS error
         FROM visits ${filter} ORDER BY visited_at DESC, id DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    ),
    query(db, `SELECT domain, COUNT(*) AS pages FROM visits GROUP BY domain ORDER BY pages DESC LIMIT 40`),
  ]);
  return {
    total: num(counted[0]?.n),
    shown: rows.length,
    offset,
    domains: domains.map((d) => ({ domain: str(d.domain), pages: num(d.pages) })),
    visits: rows.map((r) => ({
      id: num(r.id),
      at: str(r.visited_at),
      url: str(r.url),
      domain: str(r.domain),
      title: str(r.title),
      ok: num(r.ok) === 1,
      error: r.error ? str(r.error) : null,
    })),
  };
}
