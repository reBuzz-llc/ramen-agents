// Mint a board API key for one of the family's machines and write it to ~/bots/common-data/keys/peek-<name>.key
// (chmod 600, like the other keys). The token is never printed; Peek keeps only its SHA-256. Minting a name again
// revokes that name's earlier keys, so the file on disk is always the one live key.
//
//   node --env-file=.env.local scripts/api-key.mjs engine                     # board:read board:write
//   node --env-file=.env.local scripts/api-key.mjs dashboard                  # board:read only
//   node --env-file=.env.local scripts/api-key.mjs backfill board:import       # extra scopes after the name
//   node --env-file=.env.local scripts/api-key.mjs validator --tenant team     # the company's slug (default: the only one)
//   node scripts/api-key.mjs engine --pglite ~/bots/common-data/peek/pglite      # a local install (Peek stopped)
//   node --env-file=.env.local scripts/api-key.mjs owner assets:write          # PUT /v1/assets/* (the owner's key)
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { openClient } from "./db-client.mjs";

const args = process.argv.slice(2);
const t = args.indexOf("--tenant");
const slug = t >= 0 ? args.splice(t, 2)[1] : "";
const g = args.indexOf("--pglite");
const pglite = g >= 0 ? args.splice(g, 2)[1] : "";
const [name, ...extra] = args;
if (!name || !/^[a-z][a-z0-9-]{1,30}$/.test(name)) {
  console.error("usage: api-key.mjs <name> [extra scopes] [--tenant slug]   (name: engine, validator, backfill, ...)");
  process.exit(2);
}
// The Validator's key also raises and resolves flags and may clear a "False Whatsapp Number" (board:validate).
// The dashboard only reads (Reports, The CEO's measure): its key never writes.
const base = name === "dashboard" ? ["board:read"] : ["board:read", "board:write"];
const scopes = [...new Set([...base, ...(name === "validator" ? ["board:validate"] : []), ...extra])];
if (scopes.some((s) => !["board:read", "board:write", "board:import", "board:validate", "assets:write"].includes(s))) {
  console.error("scopes are board:read, board:write, board:import, board:validate and assets:write");
  process.exit(2);
}
const url = (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "").trim();
if (!url && !pglite) {
  console.error("no DATABASE_URL: run with --env-file=.env.local, or --pglite <folder> for a local install");
  process.exit(2);
}
const file = path.join(process.env.PEEK_KEYS_DIR || path.join(homedir(), "bots", "common-data", "keys"), `peek-${name}.key`);
const token = `peek_${randomBytes(32).toString("base64url")}`;
let client;
try {
  client = await openClient({ url, pglite });
} catch (err) {
  console.error("api-key:", err instanceof Error ? err.message : err);
  process.exit(1);
}
try {
  // the company: the one named, else the only one there is
  const { rows } = slug ? await client.query("select id from tenants where slug = $1", [slug]) : await client.query("select id from tenants limit 2");
  if (!rows[0]) throw new Error(slug ? `no company with the slug ${slug}` : "no company yet: start Peek once first");
  if (!slug && rows.length > 1) throw new Error("more than one company: say which with --tenant <slug>");
  await client.query("begin");
  const revoked = await client.query("update api_keys set revoked_at = now() where tenant_id = $1 and name = $2 and revoked_at is null", [rows[0].id, name]);
  await client.query("insert into api_keys (tenant_id, name, key_hash, scopes) values ($1, $2, $3, $4)", [rows[0].id, name, createHash("sha256").update(token).digest("hex"), scopes]);
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  await client.query("commit");
  // On stderr, and the file read back: a `> peek-<name>.key` redirect once put this line in the key file in place of
  // the key (2026-11-05, the dashboard's key). Run the script without redirecting it; it writes the file itself.
  if (readFileSync(file, "utf8").trim() !== token) throw new Error(`${file} does not hold the new key after writing it; run the script without redirecting its output`);
  console.error(`${name}: key written to ${file} (${scopes.join(" ")})${revoked.rowCount ? `; ${revoked.rowCount} earlier key(s) revoked` : ""}`);
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error("api-key: failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
