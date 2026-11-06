// The portal's files from one store to another (any two S3-compatible stores, for example Neon Object Storage and
// Supabase Storage, with a Postgres database each): every ready file is copied object by object: read from the old
// bucket, written to the new one under the same key, read back and compared (size and SHA-256), and only then its row
// (and its attachments to leads) written into the new database with store = TO_STORE. Resumable: a file already copied
// (its row in the new database with that store and the same size) is skipped. One log line per file. Until a file is
// copied, the portal shows it as "stored on <old store>, copy pending".
//
//   node scripts/files-copy.mjs --from old.env --to new.env [--dry-run] [--limit N] [--log files-copy.log]
//
// Each env file (KEY=VALUE lines, kept mode 600) holds DATABASE_URL, AWS_ENDPOINT_URL_S3, AWS_REGION, AWS_ACCESS_KEY_ID,
// AWS_SECRET_ACCESS_KEY and FILES_BUCKET (default "files"); the --to file also FILES_STORE, the name new uploads
// record (for example "supabase").
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sha = (b) => createHash("sha256").update(b).digest("hex");

/** Copy every ready file not yet in Supabase. `from` and `to` each have {query(sql, params) -> {rows}} and a bucket
 *  {get(key) -> Uint8Array, put(key, bytes, type)}; `log(entry)` records each file. Returns the counts. */
export async function copyFiles({ from, to, fromBucket, toBucket, log = () => {}, dry = false, limit = 0, toStore = "supabase" }) {
  const counts = { copied: 0, skipped: 0, failed: 0, attachments: 0, planned: 0 };
  // the companies and people by their slug and email: the rebuilt database has its own ids
  const tenants = new Map();
  for (const t of (await from.query("select id, slug from tenants")).rows) {
    const m = (await to.query("select id from tenants where slug = $1", [t.slug])).rows[0];
    if (m) tenants.set(t.id, m.id);
  }
  const people = new Map();
  for (const u of (await from.query("select id, email from users")).rows) {
    const m = (await to.query("select id from users where lower(email) = lower($1)", [u.email])).rows[0];
    if (m) people.set(u.id, m.id);
  }
  const files = (await from.query("select * from files where status = 'ready' and deleted_at is null order by created_at")).rows;
  for (const f of files) {
    if (limit && counts.copied + counts.failed >= limit) break;
    const tenant = tenants.get(f.tenant_id);
    if (!tenant) {
      counts.failed++;
      log({ id: f.id, name: f.name, status: "failed", why: "its company is not in the new database" });
      continue;
    }
    const there = (await to.query("select store, size from files where id = $1", [f.id])).rows[0];
    if (there && there.store === toStore && Number(there.size) === Number(f.size)) {
      counts.skipped++;
      continue;
    }
    if (dry) {
      counts.planned++;
      continue;
    }
    try {
      const bytes = await fromBucket.get(f.key);
      if (bytes.length !== Number(f.size)) throw new Error(`the old store has ${bytes.length} bytes, the row says ${f.size}`);
      const digest = sha(bytes);
      await toBucket.put(f.key, bytes, f.content_type);
      const back = await toBucket.get(f.key);
      if (back.length !== bytes.length || sha(back) !== digest) throw new Error("the copy read back differs");
      await to.query(
        `insert into files (id, tenant_id, key, name, size, content_type, tag, status, uploaded_by, created_at, store)
         values ($1, $2, $3, $4, $5, $6, $7, 'ready', $8, $9, $10)
         on conflict (id) do update set store = excluded.store, size = excluded.size, key = excluded.key, status = 'ready'`,
        [f.id, tenant, f.key, f.name, f.size, f.content_type, f.tag ?? "", people.get(f.uploaded_by) ?? null, f.created_at, toStore],
      );
      for (const a of (await from.query("select lead_id, attached_by, at from lead_files where file_id = $1", [f.id])).rows) {
        const lead = (await to.query("select id from leads where id = $1", [a.lead_id])).rows[0];
        if (!lead) continue;
        const r = await to.query("insert into lead_files (tenant_id, lead_id, file_id, attached_by, at) values ($1, $2, $3, $4, $5) on conflict do nothing", [tenant, a.lead_id, f.id, people.get(a.attached_by) ?? null, a.at]);
        counts.attachments += r.rowCount ?? r.affectedRows ?? 0;
      }
      counts.copied++;
      log({ id: f.id, name: f.name, size: Number(f.size), sha256: digest, status: "copied" });
    } catch (err) {
      counts.failed++;
      log({ id: f.id, name: f.name, status: "failed", why: String(err?.message ?? err).slice(0, 200) });
    }
  }
  return { files: files.length, ...counts };
}

// ---- the real stores ------------------------------------------------------------------------------------------------
const readEnvFile = (file) =>
  existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, "utf8")
          .split("\n")
          .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
          .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
      )
    : {};

/** Supabase's S3 endpoint and region from its database address: postgres.<ref>@aws-0-<region>.pooler.supabase.com. */
export function supabaseS3(dbUrl) {
  const u = new URL(dbUrl);
  const ref = /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(u.username))?.[1] ?? /^db\.([a-z0-9]+)\.supabase\.co$/.exec(u.hostname)?.[1];
  const region = /^aws-\d+-([a-z0-9-]+)\.pooler\.supabase\.com$/.exec(u.hostname)?.[1];
  if (!ref) throw new Error("cannot read the Supabase project ref from supabase-peek.key");
  return { endpoint: `https://${ref}.supabase.co/storage/v1/s3`, region: region || "us-east-1" };
}

async function bucket({ endpoint, region, accessKeyId, secretAccessKey, name }) {
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
  return {
    async get(key) {
      const r = await s3.send(new GetObjectCommand({ Bucket: name, Key: key }));
      return Buffer.from(await r.Body.transformToByteArray());
    },
    async put(key, bytes, type) {
      await s3.send(new PutObjectCommand({ Bucket: name, Key: key, Body: bytes, ContentType: type }));
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : "");
  const dry = args.includes("--dry-run");
  const limit = Number(opt("--limit")) || 0;
  const logFile = opt("--log") || "files-copy.log";
  const old = readEnvFile(opt("--from"));
  const neu = readEnvFile(opt("--to"));
  const need = ["DATABASE_URL", "AWS_ENDPOINT_URL_S3", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];
  const missing = [...need.filter((k) => !old[k]).map((k) => `--from ${k}`), ...need.filter((k) => !neu[k]).map((k) => `--to ${k}`)];
  if (missing.length) throw new Error(`usage: --from old.env --to new.env (missing: ${missing.join(", ")})`);
  const { default: pg } = await import("pg");
  const from = new pg.Client({ connectionString: old.DATABASE_URL, connectionTimeoutMillis: 15000 });
  const to = new pg.Client({ connectionString: neu.DATABASE_URL, connectionTimeoutMillis: 15000 });
  try {
    await from.connect();
  } catch (err) {
    throw new Error(`the old database does not answer (${err.message.slice(0, 120)}): run this again once it does`);
  }
  await to.connect();
  const store = (e) => bucket({ endpoint: e.AWS_ENDPOINT_URL_S3, region: e.AWS_REGION || "us-east-1", accessKeyId: e.AWS_ACCESS_KEY_ID, secretAccessKey: e.AWS_SECRET_ACCESS_KEY, name: e.FILES_BUCKET || "files" });
  const log = (e) => appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), ...e })}\n`);
  try {
    const r = await copyFiles({ from, to, fromBucket: await store(old), toBucket: await store(neu), log, dry, limit, toStore: neu.FILES_STORE || "supabase" });
    console.log(`${dry ? "dry run: " : ""}${r.files} ready files in the old store: ${r.copied} copied, ${r.skipped} already copied, ${r.failed} failed${dry ? `, ${r.planned} to copy` : ""}; ${r.attachments} attachments to leads; log ${logFile}`);
    if (r.failed) process.exitCode = 1;
  } finally {
    await from.end();
    await to.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
