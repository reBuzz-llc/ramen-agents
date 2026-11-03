// Secrets at rest: AES-256-GCM with a key that exists only in the environment (TEAMS_ENCRYPTION_KEY, 32 bytes base64).
// Stored form: "v1:<iv>:<tag>:<ciphertext>", all base64. A database dump alone never reveals a Notion token.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(raw = process.env.TEAMS_ENCRYPTION_KEY): Buffer {
  const k = Buffer.from((raw ?? "").trim(), "base64");
  if (k.length !== 32) throw new Error("TEAMS_ENCRYPTION_KEY must be 32 bytes, base64 (openssl rand -base64 32)");
  return k;
}

export function encrypt(plain: string, rawKey?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

export function decrypt(stored: string, rawKey?: string): string {
  const [v, iv, tag, body] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("not an encrypted value");
  const d = createDecipheriv("aes-256-gcm", key(rawKey), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}

/** A random token for a cookie or a magic link, and the hash we store instead of it. */
export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
