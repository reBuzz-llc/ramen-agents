// Seed the Asset page's "What we have" sections from the owner's Notion page as the bots mirror it
// (~/bots/the-ceo/raw/what-we-have.md, synced by scripts/sync_what_we_have.py), so nothing is retyped (the Asset page
// as the Notion page was). One section per "## " heading, in order, its body as written (### toggles,
// nested lists, paragraphs); the lines before the first heading (the Drive folder link) are an untitled first section.
// "## Rates" becomes the section that shows the rate card: its paragraph is kept, its "- " lines are the rate card's
// own (asset_rates, seeded by seed-assets.mjs) and are not copied. The page's content stays in the database, not in
// this repository. Sections already there are left alone unless --force, which replaces them. After migration 0026:
//   node --env-file=.env.local scripts/seed-sections.mjs [--dry-run] [--force] [--tenant <slug>] [--pglite <folder>]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ITEM = /^\s*(?:[-*]|\d+[.)])\s+/;

/** The mirror's markdown as [{title, kind, body}], without the mirror's own header (its "# " title, its description
 *  and its "Last edited on Notion" line). */
export function sectionsFromMirror(markdown) {
  const out = [];
  let cur = { title: "", lines: [] };
  const push = () => {
    const rates = /^rates$/i.test(cur.title);
    // the rate lines are the rate card's own; the mirror's note about them is the mirror's, not the owner's
    const lines = rates ? cur.lines.filter((l) => !ITEM.test(l) && !/^From Peek's Asset page/.test(l)) : cur.lines;
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
    if (header && (/^#\s/.test(line) || /^Last (edited on Notion|changed on Peek):/i.test(line) || /^What the company actually has/i.test(line))) continue;
    cur.lines.push(line);
  }
  push();
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const t = args.indexOf("--tenant");
  const slug = t >= 0 ? args.splice(t, 2)[1] : "";
  const g = args.indexOf("--pglite");
  const pglite = g >= 0 ? args.splice(g, 2)[1] : "";
  const dry = args.includes("--dry-run");
  const force = args.includes("--force");
  const bots = process.env.BOTS_DIR || path.join(homedir(), "bots");
  const sections = sectionsFromMirror(readFileSync(path.join(bots, "the-ceo", "raw", "what-we-have.md"), "utf8"));
  if (dry) {
    for (const s of sections) console.log(`${s.kind === "rates" ? "[rate card] " : ""}${s.title || "(untitled)"}: ${s.body.split("\n").length} lines`);
    return;
  }
  const url = pglite ? "" : (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "").trim();
  if (!url && !pglite) throw new Error("no DATABASE_URL: run with --env-file=.env.local, or --pglite <folder> for a local install");
  const { openClient } = await import("./db-client.mjs");
  const client = await openClient({ url, pglite });
  try {
    // the company named, else the only one there is
    const { rows } = slug ? await client.query("select id from tenants where slug = $1", [slug]) : await client.query("select id from tenants limit 2");
    if (!rows[0]) throw new Error(slug ? `no company with the slug ${slug}` : "no company yet: start Peek once first");
    if (!slug && rows.length > 1) throw new Error("more than one company: say which with --tenant <slug>");
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
