// The local board's API helpers (queue 572): the key check, the JSON answers and the errors, in the hosted portal's
// shapes, so the engine's portal_store and the Validator's portal readers cannot tell the two apart. Every answer is
// application/json, errors included ({error: {code, message}}): a 4xx without a JSON body counts as "board down" to them.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { homedir } from "node:os";
const BOTS_DIR = process.env.BOTS_DIR ?? path.join(homedir(), "bots"); // as lib/bots.ts (no import: Node's test runner loads this file)
// @ts-expect-error TS5097 -- the extension lets Node's own test runner load it; the bundlers resolve it the same
import { adoptToken, tokenName, type Actor, type Refusal, type Row, type WriteResult } from "./local-board.ts";

/** The key files setup writes (one random value each); the board learns each the first time it is used. */
export const KEY_NAMES = ["portal-engine", "portal-validator", "portal-dashboard"] as const;
const keyFile = (name: string) => path.join(process.env.EXPLORER_KEYS_DIR ?? path.join(BOTS_DIR, "common-data", "keys"), `${name}.key`);

export function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: { code, message }, ...extra }, { status, headers: { "cache-control": "no-store" } });
}

/** The bearer key's name, or a 401 answer. A key file written before the board's database is adopted on first use. */
export function keyed(req: Request): { name: string } | { res: NextResponse } {
  const auth = req.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() ?? "";
  if (!token) return { res: fail(401, "no_key", "send Authorization: Bearer <key>") };
  let name = tokenName(token);
  if (!name) {
    for (const k of KEY_NAMES) {
      try {
        if (readFileSync(keyFile(k), "utf8").trim() === token) {
          adoptToken(k, token);
          name = k;
          break;
        }
      } catch {
        /* no such key file */
      }
    }
  }
  return name ? { name } : { res: fail(401, "bad_key", "this key is not one of this board's keys") };
}

/** The agent writing: the body's actor (its name), else the key's; the Validator's key may clear a false WhatsApp. */
export function botActor(key: string, actor: unknown): Actor {
  const name = typeof actor === "string" && actor.trim() ? actor.trim().slice(0, 80) : key.replace(/^portal-/, "");
  return { kind: "bot", name, validator: key === "portal-validator" };
}

export async function body(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > 1_000_000) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A write's answer: {<noun>, created, written, refused}, 201 when created; 404 / 409 (with existing_id) / 400 otherwise. */
export function answer(noun: "lead" | "task" | "package", r: WriteResult) {
  if (r.ok) return NextResponse.json({ [noun]: r.row, created: r.created, written: r.written, refused: r.refused as Refusal[] }, { status: r.created ? 201 : 200 });
  const status = r.code === "not_found" ? 404 : r.code === "duplicate_row" ? 409 : 400;
  return fail(status, r.code, r.message, r.existingId ? { existing_id: r.existingId } : {});
}

/** A read with its ETag: 304 and no body when the reader already holds it. */
export function withEtag(req: Request, etag: string, data: Record<string, unknown>) {
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: { etag } });
  return NextResponse.json(data, { headers: { etag, "cache-control": "no-store" } });
}
export const queryHash = (search: string) => createHash("sha256").update(search).digest("hex").slice(0, 12);

/** A number from the query, or undefined; NaN when it is not a number (answered 400). */
export function num(v: string | null): number | undefined {
  return v === null || v === "" ? undefined : Number(v);
}
export const rowsAs = (rows: Row[]) => rows;
