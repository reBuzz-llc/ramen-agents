// Seed the Asset page from examples/assets.json (or --file <path>), so a new team starts with a rate card and package
// drafts instead of empty lists. A list that already has rows is left alone unless --force, which replaces it.
// Packages always land as drafts: publishing is a person's click on the Asset page. Run after the migrations:
//   node --env-file=.env.local scripts/seed-assets.mjs [--dry-run] [--force] [--tenant team] [--file examples/assets.json]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The rate lines and draft packages from the example file's JSON (blank lines and nameless packages dropped). */
export function seedFrom(json) {
  const rates = (Array.isArray(json.rates) ? json.rates : []).map((l) => String(l).trim()).filter(Boolean);
  const packages = (Array.isArray(json.packages) ? json.packages : [])
    .filter((p) => p && String(p.name ?? "").trim())
    .map((p) => ({
      name: String(p.name).trim(),
      price: String(p.price ?? "").trim(),
      offer: String(p.offer ?? "").trim(),
      buyer: String(p.buyer ?? "").trim(),
      deliverables: Array.isArray(p.deliverables) ? p.deliverables.map((x) => String(x).trim()).filter(Boolean) : [],
      status: "draft",
    }));
  return { rates, packages };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : dflt;
  };
  const slug = opt("--tenant", "team");
  const file = opt("--file", path.join(here, "..", "examples", "assets.json"));
  const dry = args.includes("--dry-run");
  const force = args.includes("--force");
  const { rates, packages } = seedFrom(JSON.parse(readFileSync(file, "utf8")));
  if (dry) {
    console.log(JSON.stringify({ rates, packages }, null, 2));
    return;
  }
  const url = (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "").trim();
  if (!url) throw new Error("no DATABASE_URL: run with --env-file=.env.local");
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query("select id from tenants where slug = $1", [slug]);
    if (!rows[0]) throw new Error(`no company with the slug ${slug}`);
    const tenant = rows[0].id;
    await client.query("begin");
    for (const [table, items, insert] of [
      ["asset_rates", rates, (x, i) => client.query("insert into asset_rates (tenant_id, position, line, updated_by) values ($1, $2, $3, 'seed')", [tenant, i + 1, x])],
      [
        "asset_packages",
        packages,
        (x, i) =>
          client.query(
            "insert into asset_packages (tenant_id, position, name, price, offer, buyer, deliverables, status, updated_by) values ($1, $2, $3, $4, $5, $6, $7, $8, 'seed')",
            [tenant, i + 1, x.name, x.price, x.offer, x.buyer, x.deliverables, x.status],
          ),
      ],
    ]) {
      const { rows: n } = await client.query(`select count(*)::int as n from ${table} where tenant_id = $1`, [tenant]);
      if (n[0].n && !force) {
        console.error(`${table}: ${n[0].n} rows already; left alone (--force replaces them)`);
        continue;
      }
      if (n[0].n) await client.query(`delete from ${table} where tenant_id = $1`, [tenant]);
      for (const [i, x] of items.entries()) await insert(x, i);
      console.error(`${table}: ${items.length} rows seeded${n[0].n ? ` (replaced ${n[0].n})` : ""}`);
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("seed-assets: failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
