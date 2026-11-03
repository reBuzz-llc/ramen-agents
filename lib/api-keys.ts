// The board API's machine keys (engine, Validator, backfill): a Bearer token whose SHA-256 is in api_keys. The key
// fixes the company and the scopes; people never use one, and the app's pages never accept one.
import { and, desc, eq, isNull } from "drizzle-orm";
import { newToken, sha256 } from "./crypto";
import type { Db } from "./db";
import { apiKeys } from "./db/schema";

export type Scope = "board:read" | "board:write" | "board:import" | "board:validate";
export type ApiKey = { id: string; tenantId: string; name: string; scopes: Scope[] };

/** The scopes, in the order Settings > API keys lists them, with what each lets a key do. */
export const SCOPES: readonly { scope: Scope; label: string }[] = [
  { scope: "board:read", label: "Read the board" },
  { scope: "board:write", label: "Write cells (a person's edit still wins)" },
  { scope: "board:validate", label: "Raise and resolve flags (the Validator)" },
  { scope: "board:import", label: "Import rows as they are (a backfill)" },
];
export const isScope = (s: unknown): s is Scope => SCOPES.some((x) => x.scope === s);

/** A key's name: lowercase, a letter first, as scripts/api-key.mjs takes it (it names the key file). */
export const KEY_NAME = /^[a-z][a-z0-9-]{1,30}$/;

/** The scopes a name starts with, as scripts/api-key.mjs gives them: the dashboard only reads, the Validator also
 *  flags, everything else reads and writes. */
export function defaultScopes(name: string): Scope[] {
  if (name === "dashboard") return ["board:read"];
  return name === "validator" ? ["board:read", "board:write", "board:validate"] : ["board:read", "board:write"];
}

/** The key behind an Authorization header, marking it used; null for none, an unknown or a revoked key. One query. */
export async function keyFor(db: Db, authorization: string | null): Promise<ApiKey | null> {
  const m = /^Bearer\s+(\S{20,200})$/.exec(authorization?.trim() ?? "");
  if (!m) return null;
  const [k] = await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(apiKeys.keyHash, sha256(m[1])), isNull(apiKeys.revokedAt)))
    .returning();
  return k ? { id: k.id, tenantId: k.tenantId, name: k.name, scopes: k.scopes as Scope[] } : null;
}

/** A new key: the token once (to write to its key file), only its hash kept. */
export async function mintKey(db: Db, tenantId: string, name: string, scopes: Scope[]) {
  const token = `peek_${newToken()}`;
  const [k] = await db.insert(apiKeys).values({ tenantId, name, keyHash: sha256(token), scopes }).returning();
  return { id: k.id, token };
}

/** Revoke one of the company's keys; false when it is not theirs or was already revoked. */
export async function revokeKey(db: Db, tenantId: string, id: string): Promise<boolean> {
  const r = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .returning();
  return r.length > 0;
}

/** The company's keys, newest first: never the token, which is not kept. */
export async function listKeys(db: Db, tenantId: string) {
  return db
    .select({ id: apiKeys.id, name: apiKeys.name, scopes: apiKeys.scopes, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt })
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, tenantId))
    .orderBy(desc(apiKeys.createdAt));
}

/** A key minted from Settings, like scripts/api-key.mjs: the name's earlier live keys are revoked in the same step, so a
 *  name always has one live key. */
export async function replaceKey(db: Db, tenantId: string, name: string, scopes: Scope[]) {
  return db.transaction(async (tx) => {
    const old = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.name, name), isNull(apiKeys.revokedAt)))
      .returning();
    const k = await mintKey(tx as unknown as Db, tenantId, name, scopes);
    return { ...k, revoked: old.length };
  });
}
