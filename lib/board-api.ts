// The board API's plumbing for the machine routes under /v1 and /api/leads/by-notion: the key check, the error shape
// ({error: {code, message}}, written for a bot's log), and the actor a key writes as.
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { keyFor, type ApiKey, type Scope } from "./api-keys";
import { db, type Db } from "./db";
import { apiKeyDays } from "./db/schema";
import type { Actor, WriteResult } from "./leads";
import type { TaskWrite } from "./tasks";

export const fail = (status: number, code: string, message: string, extra: object = {}) => NextResponse.json({ error: { code, message, ...extra } }, { status });

/** The key on the request, with the scope asked for; else the 401/403 answer. */
/** A read's answer, metered: the JSON with its size in x-peek-bytes (and any extra headers, an
 *  ETag), and the key's requests and bytes for today added up in api_key_days. A failed count never fails the read. */
export async function metered(d: Db, key: ApiKey, payload: unknown, headers: Record<string, string> = {}): Promise<NextResponse> {
  const text = JSON.stringify(payload);
  const bytes = Buffer.byteLength(text);
  await countRead(d, key.id, bytes, false);
  return new NextResponse(text, { status: 200, headers: { "content-type": "application/json", "x-peek-bytes": String(bytes), ...headers } });
}

/** 304 Not Modified for a reader whose If-None-Match is the board's current ETag: nothing travels. */
export async function notModified(d: Db, key: ApiKey, etag: string): Promise<NextResponse> {
  await countRead(d, key.id, 0, true);
  return new NextResponse(null, { status: 304, headers: { etag, "x-peek-bytes": "0" } });
}

export async function countRead(d: Db, keyId: string, bytes: number, notMod: boolean) {
  const day = new Date().toISOString().slice(0, 10);
  await d
    .insert(apiKeyDays)
    .values({ keyId, day, requests: 1, notModified: notMod ? 1 : 0, bytes })
    .onConflictDoUpdate({
      target: [apiKeyDays.keyId, apiKeyDays.day],
      set: { requests: sql`${apiKeyDays.requests} + 1`, notModified: sql`${apiKeyDays.notModified} + ${notMod ? 1 : 0}`, bytes: sql`${apiKeyDays.bytes} + ${bytes}` },
    })
    .catch((err) => console.error("[meter]", err instanceof Error ? err.message : err));
}

export async function keyed(req: Request, scope: Scope): Promise<{ d: Db; key: ApiKey } | { res: NextResponse }> {
  const d = await db();
  if (!req.headers.get("authorization")) return { res: fail(401, "unauthorized", "send your key as a Bearer token") };
  const key = await keyFor(d, req.headers.get("authorization"));
  if (!key) return { res: fail(401, "unauthorized", "that key is not active") };
  if (!key.scopes.includes(scope)) return { res: fail(403, "missing_scope", `this key has no ${scope}`) };
  return { d, key };
}

/** A key always writes as a bot: the agent named in the write (an engine key writes for many), else the key's name. */
export function botActor(key: ApiKey, named: unknown): Actor {
  const name = typeof named === "string" && named.trim() ? named.trim().slice(0, 80) : key.name;
  return { kind: "bot", name, via: key.name, validator: key.scopes.includes("board:validate") };
}

export function answer(r: WriteResult) {
  if (r.ok) return NextResponse.json({ lead: r.lead, created: r.created, written: r.written, refused: r.refused }, { status: r.created ? 201 : 200 });
  const status = r.code === "not_found" ? 404 : r.code === "duplicate_row" ? 409 : 400;
  return fail(status, r.code, r.message, r.existingId ? { existing_id: r.existingId } : {});
}

/** A write that threw: logged here, answered as the portal's failure (never the query or its values). */
export function failed(err: unknown, where: string) {
  console.error(`[${where}]`, err);
  return fail(500, "server_error", "the write failed on the portal's side; it is logged");
}

export async function body(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > 1_000_000) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const NUM = (v: string | null) => (v === null || v === "" ? undefined : Number(v));
const BOOL = (v: string | null) => (v === "true" || v === "1" ? true : v === "false" || v === "0" ? false : undefined);

/** ?since=&limit=&email_status=&whatsapp_status=&city=&industry=&min_score=&has_draft=&has_role= */
export function queryOf(url: URL) {
  const p = url.searchParams;
  return {
    since: NUM(p.get("since")),
    limit: NUM(p.get("limit")),
    emailStatus: p.get("email_status") ?? undefined,
    whatsappStatus: p.get("whatsapp_status") ?? undefined,
    city: p.get("city") ?? undefined,
    industry: p.get("industry") ?? undefined,
    minScore: NUM(p.get("min_score")),
    hasDraft: BOOL(p.get("has_draft")),
    hasRole: BOOL(p.get("has_role")),
    // archived=true: archived rows too (an incremental reader learns a lead was archived and drops it from its cache)
    archived: p.get("archived") === "true",
  };
}

/** A task write's answer, as answer() is a lead's. */
export function answerTask(r: TaskWrite) {
  if (r.ok) return NextResponse.json({ task: r.task, created: r.created, written: r.written, refused: r.refused }, { status: r.created ? 201 : 200 });
  return fail(r.code === "not_found" ? 404 : 400, r.code, r.message);
}
