// The company's Notion board, through the company's own token. Reads are cached five minutes in board_rows (Notion allows
// 3 requests a second per integration); the one write is a row's Status, read back before it is reported as done.
import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "./db";
import { boardRows } from "./db/schema";
import { ShownError } from "./errors";
import { boardOf, boardsFrom, REJECTED, type Board } from "./notion-pick";
import { text, WRITABLE, type NotionPage } from "./queue";
import { notionOf } from "./tenants";

const VERSION = "2025-09-03";
const CACHE_MS = 5 * 60 * 1000;

async function call(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": VERSION, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new NotionError(res.status, body.message ?? "");
  }
  return res.json();
}

/** A refusal from Notion, with Notion's own words ("API token is invalid.") when it gave any. */
export class NotionError extends Error {
  constructor(
    public status: number,
    public notionSays = "",
  ) {
    super(status === 401 ? REJECTED : `Notion answered HTTP ${status}${notionSays ? `: ${notionSays}` : ""}`);
  }
}

/** The integration behind a token (GET /v1/users/me): its name, or Notion's refusal as a NotionError. */
export async function whoAmI(token: string): Promise<{ name: string }> {
  const bot = (await call(token, "https://api.notion.com/v1/users/me")) as { name?: string; type?: string };
  return { name: bot.name?.trim() || "your integration" };
}

/** Every board (data source) the token's integration has been added to, likely Leads boards first. */
export async function searchBoards(token: string): Promise<Board[]> {
  const found: Parameters<typeof boardsFrom>[0] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 5; i++) {
    const body = (await call(token, "https://api.notion.com/v1/search", {
      method: "POST",
      body: JSON.stringify({ filter: { property: "object", value: "data_source" }, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    })) as { results: Parameters<typeof boardsFrom>[0]; has_more: boolean; next_cursor: string | null };
    found.push(...body.results);
    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
  }
  return boardsFrom(found);
}

/** One board by id: a data source id, or the database id from a board's URL (its first data source). Null when the
 *  integration cannot see it (Notion answers 404 for both "no such board" and "not shared with this integration"). */
export async function boardById(token: string, id: string): Promise<Board | null> {
  try {
    return boardOf({ object: "data_source", ...(await call(token, `https://api.notion.com/v1/data_sources/${id}`)) });
  } catch (e) {
    if (!(e instanceof NotionError) || (e.status !== 404 && e.status !== 400)) throw e;
  }
  try {
    const db = (await call(token, `https://api.notion.com/v1/databases/${id}`)) as { data_sources?: { id: string }[] };
    const first = db.data_sources?.[0]?.id;
    return first ? boardOf({ object: "data_source", ...(await call(token, `https://api.notion.com/v1/data_sources/${first}`)) }) : null;
  } catch (e) {
    if (e instanceof NotionError && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
}

/** A Notion page cut to what ramen-agents reads: each property's value as plain text, a select's name, people's id,
 *  name and email, a date's start, a number. Notion's rich-text formatting (annotations, links, text objects) is dropped,
 *  which takes the cached board from about 3 KB a row to a fraction of it: every page view reads the cache. */
export function slimPage(p: NotionPage, keep?: readonly string[]): NotionPage {
  const props: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(p.properties ?? {})) {
    if (keep && !keep.includes(k)) continue;
    const type = v.type as string;
    const val = v[type] as unknown;
    let slim: unknown = val;
    if (Array.isArray(val) && (type === "title" || type === "rich_text")) slim = [{ plain_text: (val as { plain_text?: string }[]).map((x) => x.plain_text ?? "").join("") }];
    else if (type === "select" || type === "status") slim = val ? { name: (val as { name?: string }).name ?? "" } : null;
    else if (type === "multi_select") slim = ((val as { name?: string }[] | null) ?? []).map((x) => ({ name: x.name ?? "" }));
    else if (type === "people") slim = ((val as { id?: string; name?: string; person?: { email?: string } }[] | null) ?? []).map((u) => ({ id: u.id, name: u.name, person: { email: u.person?.email } }));
    else if (type === "date") slim = val ? { start: (val as { start?: string }).start ?? null } : null;
    else if (type === "unique_id") slim = val;
    else if (type === "formula" || type === "rollup" || type === "relation" || type === "files") continue; // not read here
    props[k] = { type, [type]: slim };
  }
  return { id: p.id, url: p.url, created_time: p.created_time, last_edited_time: p.last_edited_time, properties: props };
}

/** The Leads columns ramen-agents reads (the queue, its filters, the scoreboard). Everything else on the board (pain
 *  point, site health, sources...) stays in Notion: caching it would only make every read slower. */
export const LEAD_COLUMNS = [
  "Business", "Website", "Business email", "Whatsapp", "Status", "How can I help", "Draft email", "Draft Whatsapp msg",
  "Contact person", "Contact role", "Industry", "Location", "Result", "Result date", "Sent by", "Lead score",
] as const;
export const DRAFTS = ["Draft email", "Draft Whatsapp msg"] as const;
/** Lists carry the drafts' first characters only (enough to tell an email from a "skip:" note); the full text is read
 *  when a card is opened or copied (draftsOf). */
export const DRAFT_PREVIEW = 80;

export function cutDrafts(p: NotionPage): NotionPage {
  const props = { ...p.properties };
  for (const k of DRAFTS) {
    const v = props[k];
    const t = (v?.rich_text as { plain_text?: string }[] | undefined)?.[0]?.plain_text;
    if (t && t.length > DRAFT_PREVIEW) props[k] = { ...v, rich_text: [{ plain_text: t.slice(0, DRAFT_PREVIEW) }], cut: true };
  }
  return { ...p, properties: props };
}

// The board, per company, kept in this server's memory for a minute: most page views then read nothing at all.
const MEMORY_MS = 60 * 1000;
const memory = new Map<string, { at: number; pages: NotionPage[] }>();
const refreshing = new Map<string, Promise<NotionPage[]>>();

/** Read the whole board from Notion and replace the company's cache (rows slimmed). One refresh per company at a time. */
function refreshBoard(db: Db, tenantId: string): Promise<NotionPage[]> {
  const running = refreshing.get(tenantId);
  if (running) return running;
  const job = (async () => {
    const conn = await notionOf(db, tenantId);
    if (!conn) throw new ShownError("No Notion board connected yet: the owner connects it in Settings.");
    const pages: NotionPage[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 50; i++) {
      const body = (await call(conn.token, `https://api.notion.com/v1/data_sources/${conn.leads}/query`, {
        method: "POST",
        body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
      })) as { results: NotionPage[]; has_more: boolean; next_cursor: string | null };
      pages.push(...body.results.map((r) => slimPage(r, LEAD_COLUMNS)));
      if (!body.has_more || !body.next_cursor) break;
      cursor = body.next_cursor;
    }
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.delete(boardRows).where(and(eq(boardRows.tenantId, tenantId), lt(boardRows.fetchedAt, now)));
      if (pages.length) await tx.insert(boardRows).values(pages.map((p) => ({ tenantId, pageId: p.id, data: p as unknown as Record<string, unknown>, fetchedAt: now })));
    });
    const listed = pages.map(cutDrafts);
    memory.set(tenantId, { at: Date.now(), pages: listed });
    return listed;
  })().finally(() => refreshing.delete(tenantId));
  refreshing.set(tenantId, job);
  return job;
}

/** Run a refresh after the response is sent (Next's after()), or simply in the background outside a request. */
function inBackground(task: () => Promise<unknown>) {
  const run = () => task().catch((err) => console.error("[board refresh]", err));
  import("next/server")
    .then((m) => m.after(run))
    .catch(() => void run());
}

/** Every row of the tenant's Leads board. From memory when read in the last minute; else from the database cache, and
 *  when that is older than five minutes the stale rows are served at once and Notion is read after the response.
 *  Only an empty cache, or `fresh` (the Refresh button), waits for Notion. */
export async function boardPages(db: Db, tenantId: string, fresh = false): Promise<NotionPage[]> {
  if (fresh) return refreshBoard(db, tenantId);
  const hot = memory.get(tenantId);
  if (hot && Date.now() - hot.at < MEMORY_MS) return hot.pages;
  // The drafts cut in the database itself, so only their first characters cross the (long) wire.
  const preview = (k: string) => {
    const path = `{properties,${k},rich_text,0,plain_text}`;
    return sql`jsonb_build_object('type', 'rich_text', 'rich_text', jsonb_build_array(jsonb_build_object('plain_text', coalesce(left(${boardRows.data} #>> ${path}::text[], ${DRAFT_PREVIEW}), ''))), 'cut', coalesce(length(${boardRows.data} #>> ${path}::text[]) > ${DRAFT_PREVIEW}, false))`;
  };
  const cached = await db
    .select({
      data: sql<Record<string, unknown>>`jsonb_set(jsonb_set(${boardRows.data}, '{properties,Draft email}', ${preview("Draft email")}), '{properties,Draft Whatsapp msg}', ${preview("Draft Whatsapp msg")})`,
      fetchedAt: boardRows.fetchedAt,
    })
    .from(boardRows)
    .where(eq(boardRows.tenantId, tenantId));
  if (!cached.length) return refreshBoard(db, tenantId);
  const pages = cached.map((r) => r.data as unknown as NotionPage);
  memory.set(tenantId, { at: Date.now(), pages });
  const oldest = Math.min(...cached.map((r) => r.fetchedAt.getTime()));
  if (Date.now() - oldest >= CACHE_MS) inBackground(() => refreshBoard(db, tenantId));
  return pages;
}

/** Forget the company's board in memory (after a disconnect or a change of board). */
export const forgetBoard = (tenantId: string) => memory.delete(tenantId);

/** Set one row's Status ("Ready to Send Email" or "Email Sent") and read it back; the cache row is refreshed too. */
export async function setStatus(db: Db, tenantId: string, pageId: string, status: (typeof WRITABLE)[number]) {
  if (!WRITABLE.includes(status)) return { ok: false as const, status: "", error: `status must be one of ${WRITABLE.join(", ")}` };
  if (!/^[0-9a-f-]{32,36}$/i.test(pageId)) return { ok: false as const, status: "", error: "not a Notion page id" };
  const conn = await notionOf(db, tenantId);
  if (!conn) return { ok: false as const, status: "", error: "no Notion board connected" };
  await call(conn.token, `https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { Status: { select: { name: status } } } }),
  });
  const page = slimPage((await call(conn.token, `https://api.notion.com/v1/pages/${pageId}`)) as NotionPage);
  // The row as Notion now has it, in memory too, so the next read shows it without waiting for a refresh.
  const hot = memory.get(tenantId);
  if (hot) hot.pages = hot.pages.map((p) => (p.id === page.id ? cutDrafts(slimPage(page, LEAD_COLUMNS)) : p));
  await db
    .insert(boardRows)
    .values({ tenantId, pageId, data: page as unknown as Record<string, unknown> })
    .onConflictDoUpdate({ target: [boardRows.tenantId, boardRows.pageId], set: { data: page as unknown as Record<string, unknown>, fetchedAt: new Date() } });
  const now = text(page.properties.Status);
  return now === status ? { ok: true as const, status: now } : { ok: false as const, status: now, error: `Notion now shows "${now || "no status"}"` };
}

const taskCache = new Map<string, { at: number; pages: NotionPage[] }>();
export const forgetTasks = (tenantId: string) => taskCache.delete(tenantId);

/** The tenant's task board (for "tasks done"), cached five minutes in memory; [] when no task board is connected. */
export async function taskPages(db: Db, tenantId: string): Promise<NotionPage[]> {
  const hit = taskCache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.pages;
  const conn = await notionOf(db, tenantId);
  if (!conn?.tasks) return [];
  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const body = (await call(conn.token, `https://api.notion.com/v1/data_sources/${conn.tasks}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    })) as { results: NotionPage[]; has_more: boolean; next_cursor: string | null };
    pages.push(...body.results.map((r) => slimPage(r)));
    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
  }
  taskCache.set(tenantId, { at: Date.now(), pages });
  return pages;
}

/** One row's full drafts, read when its card is opened or copied: the lists carry only their first characters. */
export async function draftsOf(db: Db, tenantId: string, pageId: string): Promise<{ draft: string; whatsappDraft: string } | null> {
  const [r] = await db
    .select({
      draft: sql<string>`coalesce(${boardRows.data} #>> '{properties,Draft email,rich_text,0,plain_text}', '')`,
      whatsappDraft: sql<string>`coalesce(${boardRows.data} #>> '{properties,Draft Whatsapp msg,rich_text,0,plain_text}', '')`,
    })
    .from(boardRows)
    .where(and(eq(boardRows.tenantId, tenantId), eq(boardRows.pageId, pageId)));
  return r ?? null;
}
