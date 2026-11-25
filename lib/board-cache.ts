// The Leads board's rows, cached, so Peek does not go to the database on every visit. A board read is 5,930 rows with per-row subqueries; it changes only when a lead is written (leads.rev), a
// lead is taken or given back (claims) or a flag opens or closes (lead_flags). The fingerprint of those three is one
// small query; the rows are kept per company, person and tab until it changes, and the browser gets an ETag on it, so an
// unchanged board costs one round trip and no rows.
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { Db } from "./db";
import { claims, leadFlags, leads } from "./db/schema";
import { boardOf, tableOf } from "./leads";
import { heldFingerprint } from "./board-fp";

export type RowsTab = "board" | "table";
/** The Table's long cells (cut already): its first rows on the page leave them out, the full rows bring them. */
export const SLIM_FIRST = ["painPoint", "draftEmail", "draftWhatsapp", "evidence", "sourcePages", "siteHealth", "notes"] as const;
export function slimRow<T extends Record<string, unknown>>(r: T): T {
  const out: Record<string, unknown> = { ...r };
  for (const k of SLIM_FIRST) delete out[k];
  return out as T;
}
/** How many rows the page itself carries; the browser fetches the rest (app/api/leads/rows). */
export const FIRST_ROWS = 200;
const KEEP = 60;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null | undefined));

/** One stored row as the board's client reads it (dates as text, flags as booleans and numbers). */
export type ClientRow = Record<string, unknown> & { id: string; hasDraft: boolean; hasWhatsapp: boolean; mine: boolean; corrected: boolean; openFlags: number; updatedAt: string; sentAt: string | null | undefined; createdAt: string | undefined };
export function toClientRow(r: Record<string, unknown>): ClientRow {
  return {
    id: String(r.id),
    ...r,
    hasDraft: !!r.hasDraft,
    hasWhatsapp: !!r.hasWhatsapp,
    mine: !!r.mine,
    corrected: !!r.corrected,
    openFlags: Number(r.openFlags ?? 0),
    updatedAt: iso(r.updatedAt) ?? "",
    sentAt: iso(r.sentAt),
    createdAt: iso(r.createdAt) ?? undefined,
  };
}

/** What the board's rows depend on, as one short string: the newest lead rev, the claims and the flags. */
export async function boardFingerprint(db: Db, tenantId: string): Promise<string> {
  const [r] = await db
    .select({
      rev: sql<string>`(select coalesce(max(${leads.rev}), 0)::text from ${leads} where ${leads.tenantId} = ${tenantId})`,
      claims: sql<string>`(select count(*)::text || ':' || coalesce(extract(epoch from max(${claims.at}))::text, '0') from ${claims} where ${claims.tenantId} = ${tenantId})`,
      flags: sql<string>`(select count(*) filter (where ${leadFlags.status} = 'open')::text || ':' || coalesce(extract(epoch from max(greatest(${leadFlags.firstSeen}, coalesce(${leadFlags.resolvedAt}, ${leadFlags.firstSeen}))))::text, '0') from ${leadFlags} where ${leadFlags.tenantId} = ${tenantId})`,
    })
    .from(sql`(select 1) as one`);
  return `${r?.rev ?? 0}|${r?.claims ?? ""}|${r?.flags ?? ""}`;
}

const g = globalThis as { __boardRows?: Map<string, { fp: string; rows: ClientRow[]; gz?: Buffer }> };

/** The person's rows for a tab, from the cache when the board has not changed. `hit` says which. */
export async function cachedRows(db: Db, tenantId: string, userId: string, tab: RowsTab, fp?: string): Promise<{ fp: string; rows: ClientRow[]; hit: boolean }> {
  const print = fp ?? (await heldFingerprint(tenantId, () => boardFingerprint(db, tenantId)));
  const cache = (g.__boardRows ??= new Map());
  const key = `${tenantId}:${userId}:${tab}`;
  const got = cache.get(key);
  if (got && got.fp === print) return { fp: print, rows: got.rows, hit: true };
  const raw = tab === "table" ? await tableOf(db, tenantId, userId) : await boardOf(db, tenantId, userId);
  const rows = raw.map((r) => toClientRow(r as Record<string, unknown>));
  cache.delete(key);
  cache.set(key, { fp: print, rows });
  while (cache.size > KEEP) cache.delete(cache.keys().next().value!);
  return { fp: print, rows, hit: false };
}

/** The rows as gzipped JSON ({rows}), made once per cached copy: 5,930 rows are about 2.7 MB as text, a tenth gzipped. */
export function gzRows(tenantId: string, userId: string, tab: RowsTab, fp: string, rows: ClientRow[]): Buffer {
  const got = g.__boardRows?.get(`${tenantId}:${userId}:${tab}`);
  if (got && got.fp === fp && got.gz) return got.gz;
  const gz = gzipSync(JSON.stringify({ rows }), { level: 6 });
  if (got && got.fp === fp) got.gz = gz;
  return gz;
}

/** The ETag for a person's tab at a fingerprint. */
export const rowsEtag = (fp: string, userId: string, tab: RowsTab) => `W/"rows-${tab}-${createHash("sha256").update(`${fp}|${userId}`).digest("hex").slice(0, 20)}"`;

/** How many live leads the company has (the tab counts while the rows load). */
export async function boardCount(db: Db, tenantId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.archived, false)));
  return Number(r?.n ?? 0);
}
