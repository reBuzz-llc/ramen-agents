// Seed the Asset page's "What we have" sections from examples/company.md (or --file <path>), so a new team starts with
// the shape of the page instead of an empty one. One section per "## " heading, in order, its body as written (###
// toggles, nested lists, paragraphs); the lines before the first heading (a shared folder link) are an untitled first
// section. "## Rates" becomes the section that shows the rate card: its paragraph is kept, its "- " lines are the rate
// card's own (asset_rates, seeded by seed-assets.mjs) and are not copied. Sections already there are left alone unless
// --force, which replaces them. Run after the migrations:
//   node --env-file=.env.local scripts/seed-sections.mjs [--dry-run] [--force] [--tenant team] [--file examples/company.md]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ITEM = /^\s*(?:[-*]|\d+[.)])\s+/;

/** The markdown as [{title, kind, body}], without its own "# " title. */
export function sectionsFrom(markdown) {
  const out = [];
  let cur = { title: "", lines: [] };
  const push = () => {
    const rates = /^rates$/i.test(cur.title);
    // the rate lines are the rate card's own
    const lines = rates ? cur.lines.filter((l) => !ITEM.test(l)) : cur.lines;
    const body = lines
      .map((l) => l.replace(/\s+$/, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (cur.title || body) out.push({ title: cur.title, kind: rates ? "rates" : "text", body });
  };
  let header = true;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      push();
      header = false;
      cur = { title: h2[1].trim(), lines: [] };
      continue;
    }
    if (header && /^#\s/.test(line)) continue;
    cur.lines.push(line);
  }
  push();
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const t = args.indexOf("--tenant");
  const slug = t >= 0 ? args.splice(t, 2)[1] : "team";
  const fi = args.indexOf("--file");
  const file = fi >= 0 ? args.splice(fi, 2)[1] : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "examples", "company.md");
  const dry = args.includes("--dry-run");
  const force = args.includes("--force");
  const sections = sectionsFrom(readFileSync(file, "utf8"));
  if (dry) {
    for (const s of sections) console.log(`${s.kind === "rates" ? "[rate card] " : ""}${s.title || "(untitled)"}: ${s.body.split("\n").length} lines`);
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
    const { rows: n } = await client.query("select count(*)::int as n from asset_sections where tenant_id = $1", [tenant]);
    if (n[0].n && !force) {
      console.log(`asset_sections: ${n[0].n} already there, left alone (--force replaces them)`);
      await client.query("rollback");
      return;
    }
    if (n[0].n) await client.query("delete from asset_sections where tenant_id = $1", [tenant]);
    for (const [i, s] of sections.entries()) {
      await client.query("insert into asset_sections (tenant_id, position, title, kind, body, updated_by) values ($1, $2, $3, $4, $5, 'seed')", [tenant, i + 1, s.title, s.kind, s.body]);
    }
    await client.query("commit");
    console.log(`asset_sections: ${sections.length} seeded`);
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
