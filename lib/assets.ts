// The Asset page's two lists: the rate card and the packages, so the owner's Notion "What we have"
// page can retire. The page, PUT /v1/assets/* (an assets:write key) and GET /v1/assets/* (any board:read key: the
// Validator's price guard, the Writer's offer reader) all go through here. A save sends the whole list in the order it
// should read: rows with an id are kept (and only touched when they changed), rows without one are added, rows left out
// are deleted. One transaction, so a reader never sees half a list.
import { and, asc, eq, inArray, isNotNull, max, sql } from "drizzle-orm";
import type { Db } from "./db";
import { assetPackages, assetRates, assetSections } from "./db/schema";

export const MAX_ITEMS = 200;
export const STATUSES = ["draft", "published"] as const;
export type PackageStatus = (typeof STATUSES)[number];

export type RateIn = { id?: string; line: string };
export type PackageIn = {
  id?: string;
  name: string;
  price: string;
  offer: string;
  buyer: string;
  deliverables: string[];
  status: PackageStatus;
  /** The ready-to-send email, line breaks kept: the Outreach Writer builds a package's first email on it. */
  email: string;
  /** Why this package and price, and the pages it rests on (a handover's, or the Notion toggle's). */
  why: string;
  sources: string[];
};
export type Rate = { id: string; position: number; line: string; offer: string; price: string; updatedAt: string; updatedBy: string };
export type Package = PackageIn & {
  id: string;
  position: number;
  updatedAt: string;
  updatedBy: string;
  /** A bot's handover: who handed it over and when. */
  handedOverBy: string | null;
  handedOverAt: string | null;
};
export const SECTION_KINDS = ["text", "rates"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];
export type SectionIn = { id?: string; title: string; kind: SectionKind; body: string };
export type Section = SectionIn & { id: string; position: number; updatedAt: string; updatedBy: string };
export type Checked<T> = { ok: true; items: T[] } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
/** Text whose line breaks matter (an email): each line trimmed at the end, runs of blank lines kept to one. */
const block = (v: unknown, max: number) =>
  typeof v === "string"
    ? v
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((l) => l.replace(/\s+$/, ""))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, max)
    : "";
const urls = (v: unknown) => (Array.isArray(v) ? v.map((u) => str(u, 500)).filter((u) => /^https?:\/\//i.test(u)).slice(0, 20) : []);

/** "Starter site: a one-page website ..." -> offer "Starter site", price the rest; no ": " -> all offer. */
export function splitLine(line: string): { offer: string; price: string } {
  const i = line.indexOf(": ");
  return i < 0 ? { offer: line.trim(), price: "" } : { offer: line.slice(0, i).trim(), price: line.slice(i + 2).trim() };
}

const idOf = (v: unknown): string | undefined | null => (v === undefined || v === null || v === "" ? undefined : typeof v === "string" && UUID.test(v) ? v : null);

/** A rate list from a page or a key: strings or {id?, line}; empty lines dropped. */
export function checkRates(input: unknown): Checked<RateIn> {
  if (!Array.isArray(input)) return { ok: false, message: "send rates as a list: [{line}] or [\"Offer: price\"]" };
  if (input.length > MAX_ITEMS) return { ok: false, message: `at most ${MAX_ITEMS} rate lines` };
  const items: RateIn[] = [];
  for (const [i, x] of input.entries()) {
    const o = typeof x === "string" ? { line: x } : x && typeof x === "object" ? (x as Record<string, unknown>) : null;
    if (!o) return { ok: false, message: `rate ${i + 1} is neither a line nor {line}` };
    const id = idOf(o.id);
    if (id === null) return { ok: false, message: `rate ${i + 1} has an id that is not one of the portal's` };
    const line = str(o.line, 1000);
    if (line) items.push({ id, line });
  }
  return { ok: true, items };
}

/** A package list: a name each; status draft unless "published"; deliverables a list of lines (or one per line). */
export function checkPackages(input: unknown): Checked<PackageIn> {
  if (!Array.isArray(input)) return { ok: false, message: "send packages as a list: [{name, price, offer, buyer, deliverables, status}]" };
  if (input.length > MAX_ITEMS) return { ok: false, message: `at most ${MAX_ITEMS} packages` };
  const items: PackageIn[] = [];
  for (const [i, x] of input.entries()) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return { ok: false, message: `package ${i + 1} is not an object` };
    const o = x as Record<string, unknown>;
    const id = idOf(o.id);
    if (id === null) return { ok: false, message: `package ${i + 1} has an id that is not one of the portal's` };
    const name = str(o.name, 200);
    if (!name) return { ok: false, message: `package ${i + 1} has no name` };
    if (o.status !== undefined && !STATUSES.includes(o.status as PackageStatus)) return { ok: false, message: `package ${i + 1}: status is draft or published` };
    const raw = Array.isArray(o.deliverables) ? o.deliverables : typeof o.deliverables === "string" ? o.deliverables.split("\n") : [];
    const deliverables = raw.map((d) => str(d, 1000)).filter(Boolean).slice(0, 50);
    items.push({
      id,
      name,
      price: str(o.price, 1000),
      offer: str(o.offer, 1000),
      buyer: str(o.buyer, 1000),
      deliverables,
      status: (o.status as PackageStatus) ?? "draft",
      email: block(o.email, 8000),
      why: str(o.why, 2000),
      sources: urls(o.sources),
    });
  }
  return { ok: true, items };
}

export async function listRates(db: Db, tenantId: string): Promise<Rate[]> {
  const rows = await db.select().from(assetRates).where(eq(assetRates.tenantId, tenantId)).orderBy(asc(assetRates.position));
  return rows.map((r) => ({ id: r.id, position: r.position, line: r.line, ...splitLine(r.line), updatedAt: r.updatedAt.toISOString(), updatedBy: r.updatedBy }));
}

export async function listPackages(db: Db, tenantId: string, only?: PackageStatus): Promise<Package[]> {
  const where = only ? and(eq(assetPackages.tenantId, tenantId), eq(assetPackages.status, only)) : eq(assetPackages.tenantId, tenantId);
  const rows = await db.select().from(assetPackages).where(where).orderBy(asc(assetPackages.position));
  return rows.map((p) => ({
    id: p.id,
    position: p.position,
    name: p.name,
    price: p.price,
    offer: p.offer,
    buyer: p.buyer,
    deliverables: p.deliverables,
    status: p.status as PackageStatus,
    email: p.email,
    updatedAt: p.updatedAt.toISOString(),
    updatedBy: p.updatedBy,
    why: p.why,
    sources: p.sources,
    handedOverBy: p.handedOverBy,
    handedOverAt: p.handedOverAt ? p.handedOverAt.toISOString() : null,
  }));
}

/** The latest change in a list, for the API's top-level updated_at. */
export const latest = (rows: { updatedAt: string }[]) => rows.reduce<string | null>((m, r) => (!m || r.updatedAt > m ? r.updatedAt : m), null);

type Table = typeof assetRates | typeof assetPackages | typeof assetSections;

/** Replace a company's list: keep, change, add and delete in one step. An id from another company, or one that is not
 *  in the list any more, is refused, so a stale page cannot bring a deleted row back under its old id. `known` is the ids
 *  the page loaded: only those can be deleted, so a draft a bot handed over while someone was editing stays (after the
 *  list). The owner's PUT sends no `known` and replaces the whole list. */
async function replace<T extends { id?: string }>(
  db: Db,
  table: Table,
  tenantId: string,
  items: T[],
  by: string,
  same: (row: Record<string, unknown>, item: T) => boolean,
  values: (item: T) => Record<string, unknown>,
  known?: Set<string>,
): Promise<{ ok: true; added: number; changed: number; removed: number } | { ok: false; message: string }> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const existing = (await t.select().from(table).where(eq(table.tenantId, tenantId))) as unknown as (Record<string, unknown> & { id: string; position: number })[];
    const byId = new Map(existing.map((r) => [r.id, r]));
    const ids = items.map((x) => x.id).filter((x): x is string => !!x);
    if (new Set(ids).size !== ids.length) return { ok: false as const, message: "the same id twice in the list" };
    const unknown = ids.find((id) => !byId.has(id));
    if (unknown) return { ok: false as const, message: `no row ${unknown} here (deleted, or another company's); reload and save again` };
    const keep = new Set(ids);
    const gone = existing.filter((r) => !keep.has(r.id) && (!known || known.has(r.id))).map((r) => r.id);
    const unseen = existing.filter((r) => !keep.has(r.id) && known && !known.has(r.id)).sort((a, b) => a.position - b.position);
    if (gone.length) await t.delete(table).where(and(eq(table.tenantId, tenantId), inArray(table.id, gone)));
    let added = 0;
    let changed = 0;
    const now = new Date();
    for (const [i, item] of items.entries()) {
      const position = i + 1;
      const row = item.id ? byId.get(item.id) : undefined;
      if (!row) {
        await t.insert(table).values({ tenantId, position, updatedBy: by, ...values(item) } as never);
        added++;
      } else if (!same(row, item)) {
        await t.update(table).set({ position, updatedBy: by, updatedAt: now, ...values(item) } as never).where(eq(table.id, row.id));
        changed++;
      } else if (row.position !== position) {
        await t.update(table).set({ position } as never).where(eq(table.id, row.id)); // a move is not an edit
      }
    }
    for (const [i, row] of unseen.entries()) {
      if (row.position !== items.length + i + 1) await t.update(table).set({ position: items.length + i + 1 } as never).where(eq(table.id, row.id));
    }
    return { ok: true as const, added, changed, removed: gone.length };
  });
}

export const saveRates = (db: Db, tenantId: string, items: RateIn[], by: string, known?: Set<string>) =>
  replace(db, assetRates, tenantId, items, by, (r, x) => r.line === x.line, (x) => ({ line: x.line }), known);

export const savePackages = (db: Db, tenantId: string, items: PackageIn[], by: string, known?: Set<string>) =>
  replace(
    db,
    assetPackages,
    tenantId,
    items,
    by,
    (r, x) =>
      r.name === x.name &&
      r.price === x.price &&
      r.offer === x.offer &&
      r.buyer === x.buyer &&
      r.status === x.status &&
      r.email === x.email &&
      r.why === x.why &&
      JSON.stringify(r.sources) === JSON.stringify(x.sources) &&
      JSON.stringify(r.deliverables) === JSON.stringify(x.deliverables),
    (x) => ({ name: x.name, price: x.price, offer: x.offer, buyer: x.buyer, deliverables: x.deliverables, status: x.status, email: x.email, why: x.why, sources: x.sources }),
    known,
  );

/** The ids a page loaded ({known: [...]}), or undefined when the caller sent none (a full replace). */
export function knownIds(v: unknown): Set<string> | undefined {
  return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === "string" && UUID.test(x))) : undefined;
}

export type DraftIn = { name: string; price: string; offer: string; buyer: string; deliverables: string[]; why: string; sources: string[] };

/** A bot's handover as a draft package: a name, a price and something the client gets; never a status. */
export function checkDraft(input: unknown): { ok: true; draft: DraftIn } | { ok: false; message: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, message: "send the package: {name, price, buyer, deliverables, offer?, why?, sources?}" };
  const o = input as Record<string, unknown>;
  const name = str(o.name, 200);
  const price = str(o.price, 1000);
  if (!name || !price) return { ok: false, message: "a handed-over package needs a name and a price" };
  const lines = (v: unknown, n: number) => (Array.isArray(v) ? v.map((d) => str(d, 1000)).filter(Boolean).slice(0, n) : []);
  const deliverables = lines(o.deliverables, 50);
  if (!deliverables.length) return { ok: false, message: "a handed-over package needs at least one deliverable" };
  const sources = urls(o.sources);
  return { ok: true, draft: { name, price, offer: str(o.offer, 1000), buyer: str(o.buyer, 1000), deliverables, why: str(o.why, 2000), sources } };
}

/** A bot's handover lands as a draft: the same bot's earlier draft of that name is updated in place;
 *  otherwise a new draft goes to the end of the list. A published package, or a draft a person made, is never touched,
 *  and nothing a bot sends is ever published: the owner prices and publishes on the page. */
export async function addDraft(db: Db, tenantId: string, d: DraftIn, by: string): Promise<{ id: string; created: boolean }> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [same] = await t
      .select({ id: assetPackages.id })
      .from(assetPackages)
      .where(
        and(
          eq(assetPackages.tenantId, tenantId),
          eq(assetPackages.status, "draft"),
          eq(assetPackages.handedOverBy, by),
          isNotNull(assetPackages.handedOverAt),
          sql`lower(${assetPackages.name}) = ${d.name.toLowerCase()}`,
        ),
      )
      .limit(1);
    const now = new Date();
    const fields = { ...d, handedOverBy: by, handedOverAt: now, updatedBy: by, updatedAt: now };
    if (same) {
      await t.update(assetPackages).set(fields).where(eq(assetPackages.id, same.id));
      return { id: same.id, created: false };
    }
    const [{ top }] = await t.select({ top: max(assetPackages.position) }).from(assetPackages).where(eq(assetPackages.tenantId, tenantId));
    const [row] = await t
      .insert(assetPackages)
      .values({ tenantId, position: (top ?? 0) + 1, status: "draft", ...fields })
      .returning();
    return { id: row.id, created: true };
  });
}

/** The API's JSON for a rate and a package (snake_case, as the board API answers). */
export const rateJson = (r: Rate) => ({ id: r.id, position: r.position, line: r.line, offer: r.offer, price: r.price, updated_at: r.updatedAt, updated_by: r.updatedBy });
export const packageJson = (p: Package) => ({
  id: p.id,
  position: p.position,
  name: p.name,
  price: p.price,
  offer: p.offer,
  buyer: p.buyer,
  deliverables: p.deliverables,
  status: p.status,
  email: p.email,
  why: p.why,
  sources: p.sources,
  handed_over_by: p.handedOverBy,
  handed_over_at: p.handedOverAt,
  updated_at: p.updatedAt,
  updated_by: p.updatedBy,
});

/** Publish drafts: a person's click only, never a key. Only the company's drafts among `ids` change;
 *  a package already published, or another company's, is left alone. Returns what was published. */
export async function publishPackages(db: Db, tenantId: string, ids: string[], by: string): Promise<{ name: string; price: string }[]> {
  const want = ids.filter((id) => UUID.test(id));
  if (!want.length) return [];
  const rows = await db
    .update(assetPackages)
    .set({ status: "published", updatedBy: by, updatedAt: new Date() })
    .where(and(eq(assetPackages.tenantId, tenantId), eq(assetPackages.status, "draft"), inArray(assetPackages.id, want)))
    .returning();
  return rows.map((r) => ({ name: r.name, price: r.price }));
}

/** A key's PUT must not publish: it may not set a package to
 *  published, change a published package's name or price, or remove a published package. The reason, or null. */
export function keyMayNotPublish(existing: { id: string; name: string; price: string; status: string }[], items: PackageIn[]): string | null {
  const byId = new Map(existing.map((p) => [p.id, p]));
  for (const it of items) {
    const was = it.id ? byId.get(it.id) : undefined;
    if (it.status === "published" && (!was || was.status !== "published")) return `"${it.name}" would be published; only a person publishes, on the Asset page`;
    if (was?.status === "published" && (it.name !== was.name || it.price !== was.price)) return `"${was.name}" is published; its name and price change only on the Asset page`;
  }
  const kept = new Set(items.map((i) => i.id).filter(Boolean));
  const gone = existing.find((p) => p.status === "published" && !kept.has(p.id));
  return gone ? `"${gone.name}" is published; it is removed only on the Asset page` : null;
}

/** A section list from the page or a key: a title or a body each (a section with neither is dropped); kind text unless
 *  "rates"; the body's line breaks and leading spaces kept (they are its lists and levels). */
export function checkSections(input: unknown): Checked<SectionIn> {
  if (!Array.isArray(input)) return { ok: false, message: "send sections as a list: [{title, body, kind?}]" };
  if (input.length > MAX_ITEMS) return { ok: false, message: `at most ${MAX_ITEMS} sections` };
  const items: SectionIn[] = [];
  for (const [i, x] of input.entries()) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return { ok: false, message: `section ${i + 1} is not an object` };
    const o = x as Record<string, unknown>;
    const id = idOf(o.id);
    if (id === null) return { ok: false, message: `section ${i + 1} has an id that is not one of the portal's` };
    if (o.kind !== undefined && !SECTION_KINDS.includes(o.kind as SectionKind)) return { ok: false, message: `section ${i + 1}: kind is text or rates` };
    const title = str(o.title, 200);
    const body = block(o.body, 20_000);
    if (title || body || o.kind === "rates") items.push({ id, title, kind: (o.kind as SectionKind) ?? "text", body });
  }
  if (items.filter((s) => s.kind === "rates").length > 1) return { ok: false, message: "only one section shows the rate card" };
  return { ok: true, items };
}

export async function listSections(db: Db, tenantId: string): Promise<Section[]> {
  const rows = await db.select().from(assetSections).where(eq(assetSections.tenantId, tenantId)).orderBy(asc(assetSections.position));
  return rows.map((s) => ({ id: s.id, position: s.position, title: s.title, kind: s.kind as SectionKind, body: s.body, updatedAt: s.updatedAt.toISOString(), updatedBy: s.updatedBy }));
}

export const saveSections = (db: Db, tenantId: string, items: SectionIn[], by: string, known?: Set<string>) =>
  replace(db, assetSections, tenantId, items, by, (r, x) => r.title === x.title && r.kind === x.kind && r.body === x.body, (x) => ({ title: x.title, kind: x.kind, body: x.body }), known);

export const sectionJson = (s: Section) => ({ id: s.id, position: s.position, title: s.title, kind: s.kind, body: s.body, updated_at: s.updatedAt, updated_by: s.updatedBy });
