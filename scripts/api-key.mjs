// Mint a board API key for one of the family's machines and write it to the fleet's common-data/keys/peek-<name>.key
// (chmod 600, like the other keys). The token is never printed; Peek keeps only its SHA-256. Minting a name again
// revokes that name's earlier keys, so the file on disk is always the one live key.
//
//   node --env-file=.env.local scripts/api-key.mjs engine                     # board:read board:write
//   node --env-file=.env.local scripts/api-key.mjs dashboard                  # board:read only
//   node --env-file=.env.local scripts/api-key.mjs backfill board:import       # extra scopes after the name
//   node --env-file=.env.local scripts/api-key.mjs validator --tenant team   # the company's slug (default team, the first company)
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const t = args.indexOf("--tenant");
const slug = t >= 0 ? args.splice(t, 2)[1] : "team";
const [name, ...extra] = args;
if (!name || !/^[a-z][a-z0-9-]{1,30}$/.test(name)) {
  console.error("usage: api-key.mjs <name> [extra scopes] [--tenant slug]   (name: engine, validator, backfill, ...)");
  process.exit(2);
}
// The Validator's key also raises and resolves flags and may clear a "False Whatsapp Number" (board:validate).
// The dashboard only reads (Reports, The CEO's measure): its key never writes.
const base = name === "dashboard" ? ["board:read"] : ["board:read", "board:write"];
const scopes = [...new Set([...base, ...(name === "validator" ? ["board:validate"] : []), ...extra])];
if (scopes.some((s) => !["board:read", "board:write", "board:import", "board:validate"].includes(s))) {
  console.error("scopes are board:read, board:write, board:import and board:validate");
  process.exit(2);
}
const url = (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "").trim();
if (!url) {
  console.error("no DATABASE_URL: run with --env-file=.env.local");
  process.exit(2);
}
const file = path.join(process.env.PEEK_KEYS_DIR || path.join(homedir(), "bots", "common-data", "keys"), `peek-${name}.key`);
const token = `peek_${randomBytes(32).toString("base64url")}`;
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query("select id from tenants where slug = $1", [slug]);
  if (!rows[0]) throw new Error(`no company with the slug ${slug}`);
  await client.query("begin");
  const revoked = await client.query("update api_keys set revoked_at = now() where tenant_id = $1 and name = $2 and revoked_at is null", [rows[0].id, name]);
  await client.query("insert into api_keys (tenant_id, name, key_hash, scopes) values ($1, $2, $3, $4)", [rows[0].id, name, createHash("sha256").update(token).digest("hex"), scopes]);
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  await client.query("commit");
  console.log(`${name}: key written to ${file} (${scopes.join(" ")})${revoked.rowCount ? `; ${revoked.rowCount} earlier key(s) revoked` : ""}`);
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error("api-key: failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
