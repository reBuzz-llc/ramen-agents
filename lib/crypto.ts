// Tokens: a random one for a cookie, a magic link or an API key, and the hash stored instead of it (never the token).
import { createHash, randomBytes } from "node:crypto";

/** A random token for a cookie or a magic link, and the hash we store instead of it. */
export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
