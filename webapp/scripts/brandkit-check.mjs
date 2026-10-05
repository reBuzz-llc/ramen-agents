#!/usr/bin/env node
// Keeps applebrandkit.md honest: checks Apple's design sources, WebKit, and this project's packages for
// anything that changed since the kit was last reviewed, and rewrites the kit's "Freshness status" section.
//
//   node scripts/brandkit-check.mjs            check and update the status section
//   node scripts/brandkit-check.mjs --notify   also show a macOS notification when something needs review
//   node scripts/brandkit-check.mjs --accept   after updating the kit and theme: make today's sources the baseline
//   node scripts/brandkit-check.mjs --quiet    print only a one-line summary (used by `npm run deploy`)
//
// No dependencies (Node 18+). Network failures are reported in the status section, never fatal.
import { execFile } from "node:child_process";
import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KIT = path.join(ROOT, "applebrandkit.md");
const STATE = path.join(ROOT, "brandkit-state.json");
const args = new Set(process.argv.slice(2));
const QUIET = args.has("--quiet");
const STALE_DAYS = 90;

const HIG_PAGES = ["color", "materials", "typography", "layout", "tab-bars", "toolbars", "buttons", "sheets", "menus", "dark-mode", "accessibility", "icons", "sf-symbols", "app-icons", "motion"];
const HIG_JSON = (slug) => `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/${slug}.json`;
const WHATS_NEW = "https://developer.apple.com/design/whats-new/";
const DEV_NEWS = "https://developer.apple.com/news/rss/news.rss";
const WEBKIT = "https://webkit.org/feed/";
const NEWS_WORDS = /design|human interface|liquid glass|sf symbols|ui kit|design kit|icon composer|typography|materials|accessibility|safari|web app|webkit|ios \d|ipados \d|macos \d/i;
const WEBKIT_WORDS = /backdrop|filter|safe area|viewport|color-scheme|prefers-|contrast|transparen|web app|home screen|manifest|push|font|typography|css|switch|dialog|popover|anchor/i;

const log = (...a) => (QUIET ? undefined : console.log(...a));

async function get(url, as = "text") {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (applebrandkit freshness check)" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return as === "json" ? res.json() : res.text();
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const DATE_RE = new RegExp(`(${MONTHS})\\s+(\\d{1,2}),\\s+(20\\d{2})`, "g");
const iso = (m, d, y) => new Date(`${m} ${d}, ${y} 12:00 UTC`).toISOString().slice(0, 10);

/** Apple's "What's new" design page: dated entries, newest first. */
async function whatsNew() {
  const text = (await get(WHATS_NEW)).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ");
  const hits = [...text.matchAll(DATE_RE)];
  const entries = [];
  for (let i = 0; i < hits.length; i++) {
    const date = iso(hits[i][1], hits[i][2], hits[i][3]);
    const until = i + 1 < hits.length ? hits[i + 1].index : hits[i].index + 400;
    const body = text.slice(hits[i].index + hits[i][0].length, until).replace(/\b(guidance|videos|articles|resources)searchterm\b/gi, " · ").replace(/\s+/g, " ").trim();
    if (body.length > 3) entries.push({ date, text: body });
  }
  // The page repeats each date as a group header and on each item: merge everything under one date.
  const byDate = new Map();
  for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e.text]);
  return [...byDate.entries()]
    .map(([date, parts]) => ({ date, text: [...new Set(parts)].join(" ").replace(/(\s·\s)+/g, " · ").replace(/^·\s*|\s*·$/g, "").slice(0, 360) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function inlineText(items) {
  return (items ?? []).map((it) => (it.type === "text" ? it.text : it.code ?? inlineText(it.inlineContent))).join("");
}
function walk(node, visit) {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === "object") {
    visit(node);
    Object.values(node).forEach((v) => walk(v, visit));
  }
}

/** One HIG page: its latest change-log date and, for Color, the system color values. */
async function higPage(slug) {
  const doc = await get(HIG_JSON(slug), "json");
  const refs = doc.references ?? {};
  let changed = null;
  const colors = {};
  walk(doc.primaryContentSections, (n) => {
    if (n.type !== "table" || !Array.isArray(n.rows)) return;
    const cell = (c) =>
      c
        .map((b) =>
          (b.inlineContent ?? [])
            .map((it) => (it.type === "image" ? refs[it.identifier]?.alt ?? "" : it.type === "text" ? it.text : it.code ?? ""))
            .join(""),
        )
        .join(" ")
        .trim();
    const head = n.rows[0].map(cell);
    if (head[0] === "Date" && head[1] === "Changes") {
      const dates = n.rows.slice(1).map((r) => cell(r[0])).map((d) => {
        const m = [...d.matchAll(DATE_RE)][0];
        return m ? iso(m[1], m[2], m[3]) : null;
      });
      changed = dates.filter(Boolean).sort().at(-1) ?? null;
    }
    if (head.includes("Default (light)")) {
      for (const r of n.rows.slice(1)) {
        const vals = r.map(cell);
        if (vals.slice(2).some((v) => v.startsWith("R-"))) colors[vals[0]] = vals.slice(2).map((v) => v.replace(/R-|G-|B-/g, "").replace(/,/g, " "));
      }
    }
  });
  const abstract = inlineText(doc.abstract);
  return { slug, changed, colors: Object.keys(colors).length ? colors : undefined, abstract };
}

/** RSS items newer than `since`, filtered by keywords. */
async function rss(url, words, since) {
  const xml = await get(url);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const pick = (tag) => (m[1].match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`)) ?? [])[1]?.trim() ?? "";
    return { title: pick("title").replace(/&amp;/g, "&"), link: pick("link"), date: new Date(pick("pubDate")).toISOString().slice(0, 10) };
  });
  return items.filter((i) => words.test(i.title) && (!since || i.date > since));
}

async function packages() {
  let outdated = {};
  try {
    await run("npm", ["outdated", "--json"], { cwd: ROOT, timeout: 60000 });
  } catch (err) {
    // npm outdated exits 1 when something is outdated; its JSON is still on stdout.
    try {
      outdated = JSON.parse(err.stdout || "{}");
    } catch {
      outdated = {};
    }
  }
  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  return Object.entries(outdated).map(([name, v]) => ({
    name,
    current: v.current,
    wanted: v.wanted,
    latest: v.latest,
    kind: v.current && v.latest && v.current.split(".")[0] !== v.latest.split(".")[0] ? "major" : "minor/patch",
    declared: all[name],
  }));
}

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

const settle = async (label, fn) => {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: `${label}: ${err instanceof Error ? err.message : String(err)}` };
  }
};

async function main() {
  const now = new Date();
  // Local dates and times: the kit is read by a person in their own time zone.
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const zone = new Intl.DateTimeFormat("en-GB", { timeZoneName: "short" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "";
  const localTime = `${today} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")} ${zone}`.trim();
  const state = await loadJson(STATE, { baseline: null, lastChecked: null });
  const base = state.baseline;

  const [wn, pages, news, webkit, pkgs] = await Promise.all([
    settle("Apple What's new", whatsNew),
    Promise.all(HIG_PAGES.map((s) => settle(`HIG ${s}`, () => higPage(s)))),
    settle("Apple Developer news", () => rss(DEV_NEWS, NEWS_WORDS)),
    settle("WebKit blog", () => rss(WEBKIT, WEBKIT_WORDS)),
    settle("npm outdated", packages),
  ]);

  const current = {
    date: today,
    whatsNewLatest: wn.ok ? (wn.value[0]?.date ?? null) : base?.whatsNewLatest ?? null,
    hig: Object.fromEntries(pages.filter((p) => p.ok).map((p) => [p.value.slug, p.value.changed])),
    colors: pages.find((p) => p.ok && p.value.slug === "color")?.value.colors ?? base?.colors,
  };

  if (args.has("--accept") || !base) {
    state.baseline = current;
    state.lastChecked = now.toISOString();
    await writeAtomic(STATE, JSON.stringify(state, null, 2) + "\n");
    if (!base) log("No baseline yet: today's sources are now the baseline.");
    else log("Baseline updated: the kit is marked as reviewed against today's sources.");
  }
  const ref = state.baseline;

  const review = [];
  const errors = [wn, ...pages, news, webkit, pkgs].filter((r) => !r.ok).map((r) => r.error);

  if (wn.ok) {
    for (const e of wn.value.filter((e) => e.date > (ref.whatsNewLatest ?? ""))) review.push(`**Apple design update, ${e.date}:** ${e.text}`);
  }
  for (const p of pages.filter((p) => p.ok)) {
    const was = ref.hig?.[p.value.slug];
    if (p.value.changed && was && p.value.changed > was) review.push(`**HIG ${p.value.slug} changed ${p.value.changed}** (kit reviewed against ${was}): ${HIG_JSON(p.value.slug).replace("/tutorials/data", "").replace(".json", "")}`);
  }
  if (current.colors && ref.colors) {
    for (const [name, vals] of Object.entries(current.colors)) {
      const old = ref.colors[name];
      if (!old || JSON.stringify(old) !== JSON.stringify(vals)) review.push(`**System color ${name} changed:** ${old ? old.join(" / ") : "new"} → ${vals.join(" / ")} (light, dark, IC light, IC dark)`);
    }
  }
  // News and WebKit posts count only when published after the kit was last reviewed.
  if (news.ok) for (const n of news.value.filter((n) => n.date > (ref.date ?? ""))) review.push(`**Apple Developer news, ${n.date}:** [${n.title}](${n.link})`);
  if (webkit.ok) for (const n of webkit.value.filter((n) => n.date > (ref.date ?? ""))) review.push(`**WebKit, ${n.date}:** [${n.title}](${n.link})`);

  const pk = pkgs.ok ? pkgs.value : [];
  const reviewedDays = ref?.date ? Math.round((new Date(`${today}T00:00`) - new Date(`${ref.date}T00:00`)) / 86400000) : null;
  const stale = reviewedDays !== null && reviewedDays > STALE_DAYS;
  const needs = review.length > 0 || stale || pk.some((p) => p.kind === "minor/patch");

  const lines = [
    "<!-- brandkit:status:start (written by scripts/brandkit-check.mjs; edits here are replaced) -->",
    `- **Last checked:** ${localTime}`,
    `- **Kit last reviewed against Apple sources:** ${ref?.date ?? "never"}${reviewedDays !== null ? ` (${reviewedDays} days ago${stale ? `, over ${STALE_DAYS}: review even if nothing below changed` : ""})` : ""}`,
    `- **Apple's latest design update on record:** ${current.whatsNewLatest ?? "unknown"}`,
    `- **Verdict:** ${needs ? "⚠️ Review needed" : "✅ Up to date"}`,
    "",
    "**Changes since the last review**",
    "",
    ...(review.length ? review.map((r) => `- ${r}`) : ["- None found."]),
    "",
    "**Packages** (`npm outdated`)",
    "",
    ...(pk.length
      ? ["| Package | Current | Latest | Kind |", "|---|---|---|---|", ...pk.map((p) => `| ${p.name} | ${p.current ?? "-"} | ${p.latest} | ${p.kind === "major" ? "major: test before adopting" : "minor/patch: safe to update"} |`)]
      : ["- All packages current."]),
    ...(errors.length ? ["", "**Could not check**", "", ...errors.map((e) => `- ${e}`)] : []),
    "<!-- brandkit:status:end -->",
  ];

  const kit = await readFile(KIT, "utf8");
  const start = kit.indexOf("<!-- brandkit:status:start");
  const end = kit.indexOf("<!-- brandkit:status:end -->");
  if (start < 0 || end < 0) throw new Error("applebrandkit.md has no brandkit:status markers");
  let next = kit.slice(0, start) + lines.join("\n") + kit.slice(end + "<!-- brandkit:status:end -->".length);
  next = next.replace(/^last_checked: .*$/m, `last_checked: ${today}`);
  if (args.has("--accept")) next = next.replace(/^last_reviewed: .*$/m, `last_reviewed: ${today}`);
  await writeAtomic(KIT, next);

  state.lastChecked = now.toISOString();
  await writeAtomic(STATE, JSON.stringify(state, null, 2) + "\n");

  const summary = needs
    ? `applebrandkit: review needed (${review.length} Apple/WebKit change${review.length === 1 ? "" : "s"}, ${pk.length} package update${pk.length === 1 ? "" : "s"}${stale ? ", kit stale" : ""})`
    : "applebrandkit: up to date";
  console.log(summary + (errors.length ? `; ${errors.length} source(s) unreachable` : ""));
  if (!QUIET) for (const r of review) console.log(" - " + r.replace(/\*\*/g, ""));

  if (args.has("--notify") && needs && process.platform === "darwin") {
    const msg = summary.replace(/^applebrandkit: /, "").replace(/"/g, "'");
    await run("/usr/bin/osascript", ["-e", `display notification "${msg}. Open ~/bots/webapp/applebrandkit.md" with title "Apple brand kit" sound name "Glass"`]).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(`applebrandkit check failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(args.has("--strict") ? 1 : 0);
});
