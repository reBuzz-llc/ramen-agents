// A sample's extra pages beside its main one (the gallery page): at most 3, each a whole page at
// <name>/index.html, checked exactly like the main page (lib/sample-page.ts checkPage: the same contact, disclosure and
// script rules), published at <slug>/<name>/, its pictures copied with the main page's at Approve and pointed at
// ../assets/. Pure, so the tests read it.
import { checkPage, type Asset, type PageLead, type Source } from "./sample-page";

export type ExtraPage = { path: string; html: string };
export const PAGES_MAX = 3;
const PATH = /^([a-z0-9][a-z0-9-]{0,39})\/index\.html$/;
const RESERVED = new Set(["assets", "index", "preview", "photos"]);

/** The page's name from its path ("gallery/index.html" -> "gallery"), or null for a bad path. */
export const pageName = (path: string): string | null => {
  const m = PATH.exec(path);
  return m && !RESERVED.has(m[1]) ? m[1] : null;
};

/** The pages as Peek keeps them, or why they are refused (the first problem, naming the page). */
export function cleanPages(raw: unknown, lead: PageLead, sources: Source[] = [], photoNames: string[] = []): { ok: true; pages: ExtraPage[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, pages: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "pages is a list of {path, html}" };
  if (raw.length > PAGES_MAX) return { ok: false, error: `${raw.length} extra pages: at most ${PAGES_MAX}` };
  const out: ExtraPage[] = [];
  for (const p of raw) {
    const path = typeof p?.path === "string" ? p.path.trim().replace(/^\/+/, "") : "";
    const name = pageName(path);
    if (!name) return { ok: false, error: `a page's path is <name>/index.html (lower-case letters, digits, dashes; not assets), not "${path.slice(0, 60)}"` };
    if (out.some((x) => x.path === path)) return { ok: false, error: `two pages at ${path}` };
    const r = checkPage(p?.html, lead, sources, { names: photoNames, extra: true });
    if (!r.ok) return { ok: false, error: `${name}: ${r.error}` };
    out.push({ path, html: r.html });
  }
  return { ok: true, pages: out };
}

/** For the preview (Peek serves each page at /samples/<id>/preview?page=<name>): links between the pages ("gallery/",
 *  "gallery/index.html", "../", "../index.html", "./") point at the preview's own addresses. `v` keeps a version. */
export function previewLinks(html: string, names: string[], current: string | null, v?: number): string {
  const q = (page: string | null) => `?${[page ? `page=${page}` : "", v ? `v=${v}` : ""].filter(Boolean).join("&")}` || "?";
  return html.replace(/\bhref\s*=\s*(["'])([^"']*)\1/gi, (all, quote: string, href: string) => {
    const up = current ? /^\.\.\/(?:index\.html)?$/.test(href) || /^\.\.\/?$/.test(href) : /^\.\/(?:index\.html)?$/.test(href) || href === "index.html";
    if (up) return `href=${quote}${q(null)}${quote}`;
    const m = (current ? /^\.\.\/([a-z0-9-]+)\/(?:index\.html)?$/ : /^\.?\/?([a-z0-9-]+)\/(?:index\.html)?$/).exec(href);
    if (m && names.includes(m[1])) return `href=${quote}${q(m[1])}${quote}`;
    return all;
  });
}

/** The pictures of a page one folder down point at the slug's own assets/ (the main page's copies, made at Approve). */
export const assetsForPage = (assets: Asset[]): Asset[] => assets.map((a) => ({ ...a, path: `../${a.path}` }));

/** The html a preview serves for `?page=<name>` (null or "" the main page), its links between pages pointed at the
 *  preview; null when the sample has no such page. */
export function previewPage(doc: { html: string; pages: ExtraPage[] }, page: string | null, v?: number): string | null {
  const names = doc.pages.map((p) => pageName(p.path)).filter((n): n is string => !!n);
  if (!page) return previewLinks(doc.html, names, null, v);
  const pg = doc.pages.find((p) => pageName(p.path) === page);
  return pg ? previewLinks(pg.html, names, page, v) : null;
}
