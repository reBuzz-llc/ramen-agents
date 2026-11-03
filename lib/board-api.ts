// The board API's plumbing for the machine routes under /v1 and /api/leads/by-notion: the key check, the error shape
// ({error: {code, message}}, written for a bot's log), and the actor a key writes as.
import { NextResponse } from "next/server";
import { keyFor, type ApiKey, type Scope } from "./api-keys";
import { db, type Db } from "./db";
import type { Actor, WriteResult } from "./leads";
import type { TaskWrite } from "./tasks";

export const fail = (status: number, code: string, message: string, extra: object = {}) => NextResponse.json({ error: { code, message, ...extra } }, { status });

/** The key on the request, with the scope asked for; else the 401/403 answer. */
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

/** A write that threw: logged here, answered as Peek's failure (never the query or its values). */
export function failed(err: unknown, where: string) {
  console.error(`[${where}]`, err);
  return fail(500, "server_error", "the write failed on Peek's side; it is logged");
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
  };
}

/** A task write's answer, as answer() is a lead's. */
export function answerTask(r: TaskWrite) {
  if (r.ok) return NextResponse.json({ task: r.task, created: r.created, written: r.written, refused: r.refused }, { status: r.created ? 201 : 200 });
  return fail(r.code === "not_found" ? 404 : 400, r.code, r.message);
}
