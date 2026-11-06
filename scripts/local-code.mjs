// The owner's first sign-in code: on the machine that runs the portal in local or outage mode, against its
// database, before anyone can sign in to issue codes on Settings → People. Prints the code once; the older codes of
// that person stop working. Same shape and hash as lib/local-codes.ts.
//   node --env-file=$HOME/bots/common-data/keys/portal-local.env scripts/local-code.mjs owner@example.com
//   DATABASE_URL=<the standby's session address> node scripts/local-code.mjs owner@example.com --remote   # outage mode
import { createHash, randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const newCode = () => {
  const raw = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
};
export const codeHash = (code) => createHash("sha256").update(`local-code:${code.toUpperCase().replace(/[^A-Z0-9]/g, "")}`).digest("hex");

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email.includes("@")) throw new Error("usage: node --env-file=<portal-local.env> scripts/local-code.mjs <email>");
  const url = (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "").trim();
  if (!url) throw new Error("no DATABASE_URL: run with --env-file pointing at the local mode env file");
  // on this machine's database by default; the outage deployment's (Supabase) only when asked by name
  const remote = !/@(127\.0\.0\.1|localhost)[:/]/.test(url);
  if (remote && !process.argv.includes("--remote")) throw new Error(`DATABASE_URL is not on this machine (${new URL(url).hostname}): add --remote to issue the code there`);
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query("select id, tenant_id from users where lower(email) = $1 and active", [email]);
    if (!rows[0]) throw new Error(`no active person with the email ${email}`);
    const code = newCode();
    await client.query("begin");
    await client.query("update local_codes set revoked_at = now() where user_id = $1 and revoked_at is null", [rows[0].id]);
    await client.query("insert into local_codes (tenant_id, user_id, code_hash, issued_by, expires_at) values ($1, $2, $3, 'local-code.mjs', now() + interval '14 days')", [rows[0].tenant_id, rows[0].id, codeHash(code)]);
    await client.query("commit");
    console.log(`Local sign-in code for ${email}: ${code} (14 days; shown once)`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
