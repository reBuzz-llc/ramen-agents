// Tokens and hashes. The AES helpers that kept the Notion token are gone with Notion.
import { createHash, randomBytes } from "node:crypto";

export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const sha256Bytes = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
