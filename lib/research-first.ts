// "Research first": own-site leads above the Validator's bar get their
// pain point from a person, by the team's research method, before any bot writes one. The Validator PUTs the list (PUT
// /v1/lists/research-first: {generated_at, bar, next: [{id, since, score}]}, `since` from its own state); Peek derives who
// is on it: a listed lead leaves as soon as a person's pain_point write is applied after its `since` (no wait for the next
// PUT). The Leads page's Research first tab and the write fence read the same membership, so the Writer may draft the
// moment a person's pain point has taken the lead off the list. The fence refuses only a bot's write of pain_point,
// draft_email or draft_whatsapp on a listed lead (reason "research_first", kept in the history as refused); a person's
// write is never refused.
import { and, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "./db";
import { leadCells, leadLists, leads } from "./db/schema";

export const LIST = "research-first";
/** The cells a bot may not write on a listed lead. */
export const FENCED = new Set(["pain_point", "draft_email", "draft_whatsapp"]);
/** Waiting longer than this is counted in the tab's header. */
export const LONG_DAYS = 7;
const MAX = 1000;

export type Item = { id: string; since: Date; score: number | null };
export type ListData = { generatedAt: string | null; bar: number | null; items: Item[] };

const dashed = (s: string) => {
  const h = s.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(h) ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : null;
};

/** Pure: the list as the Validator pushed it. An item without a Peek id is left out; without a valid `since`, the list's
 *  own time stands in; each id once. */
export function parseList(data: Record<string, unknown> | null | undefined): ListData {
  const gen = typeof data?.generated_at === "string" ? data.generated_at : null;
  const genAt = gen && !Number.isNaN(Date.parse(gen)) ? new Date(gen) : new Date(0);
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const x of Array.isArray(data?.next) ? data.next : []) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const id = typeof r.id === "string" ? dashed(r.id) : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const since = typeof r.since === "string" && !Number.isNaN(Date.parse(r.since)) ? new Date(r.since) : genAt;
    items.push({ id, since, score: typeof r.score === "number" && Number.isFinite(r.score) ? r.score : null });
  }
  return { generatedAt: gen, bar: typeof data?.bar === "number" ? data.bar : null, items };
}

/** Pure: why a pushed list is refused, or null. */
export function listProblem(b: Record<string, unknown>): string | null {
  if (!Array.isArray(b.next)) return "send the list: {generated_at, bar, next: [{id, since, score}]}";
  if (b.next.length > MAX) return `at most ${MAX} entries in next`;
  if (b.next.some((x) => !x || typeof x !== "object" || typeof (x as { id?: unknown }).id !== "string" || !dashed((x as { id: string }).id))) return "every entry names its lead by its Peek id";
  return null;
}

async function listOf(d: Db, tenantId: string): Promise<ListData | null> {
  const [l] = await d.select({ data: leadLists.data }).from(leadLists).where(and(eq(leadLists.tenantId, tenantId), eq(leadLists.name, LIST)));
  return l ? parseList(l.data) : null;
}

/** The listed leads still waiting (all of them, or only `only`): on the list, and no person's pain_point applied after
 *  their `since`. */
export async function waiting(d: Db, tenantId: string, only?: string[]): Promise<{ list: ListData | null; items: Item[] }> {
  const list = await listOf(d, tenantId);
  if (!list) return { list: null, items: [] };
  const want = only ? new Set(only) : null;
  const items = want ? list.items.filter((i) => want.has(i.id)) : list.items;
  if (!items.length) return { list, items: [] };
  const oldest = new Date(Math.min(...items.map((i) => i.since.getTime())));
  const written = await d
    .select({ leadId: leadCells.leadId, at: leadCells.at })
    .from(leadCells)
    .where(and(eq(leadCells.tenantId, tenantId), inArray(leadCells.leadId, items.map((i) => i.id)), eq(leadCells.column, "pain_point"), eq(leadCells.actorKind, "person"), eq(leadCells.outcome, "applied"), gt(leadCells.at, oldest)));
  const last = new Map<string, number>();
  for (const w of written) last.set(w.leadId, Math.max(last.get(w.leadId) ?? 0, w.at.getTime()));
  return { list, items: items.filter((i) => (last.get(i.id) ?? 0) <= i.since.getTime()) };
}

/** Whether a bot's write of a fenced cell on this lead is refused. */
export async function isListed(d: Db, tenantId: string, leadId: string): Promise<boolean> {
  return (await waiting(d, tenantId, [leadId])).items.length > 0;
}

export type ResearchRow = { id: string; business: string; website: string | null; score: number | null; since: string; days: number };
export type ResearchFirst = { generatedAt: string | null; bar: number | null; rows: ResearchRow[]; wait: number; long: number };

/** The Leads page's tab: the waiting leads that are on the board and not archived, highest Lead score first (the board's
 *  score, else the list's), then the longest waiting. */
export async function researchFirst(d: Db, tenantId: string, now = new Date()): Promise<ResearchFirst> {
  const { list, items } = await waiting(d, tenantId);
  if (!list || !items.length) return { generatedAt: list?.generatedAt ?? null, bar: list?.bar ?? null, rows: [], wait: 0, long: 0 };
  const found = await d
    .select({ id: leads.id, business: leads.business, website: leads.website, score: leads.leadScore, archived: leads.archived })
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), inArray(leads.id, items.map((i) => i.id))));
  const byId = new Map(found.filter((l) => !l.archived).map((l) => [l.id, l]));
  const rows = items
    .filter((i) => byId.has(i.id))
    .map((i) => {
      const l = byId.get(i.id)!;
      return { id: i.id, business: l.business.split(" | ")[0], website: l.website, score: l.score ?? i.score, since: i.since.toISOString(), days: Math.max(0, Math.floor((now.getTime() - i.since.getTime()) / 86400e3)) };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.days - a.days);
  return { generatedAt: list.generatedAt, bar: list.bar, rows, wait: rows.length, long: rows.filter((r) => r.days > LONG_DAYS).length };
}
