// "This week in the family" on the dashboard's home (owner, 2026-11-09, creatorCC queue 381): the newest entry of
// blog/content/family-weeks.json (written on Sundays) with its link to the public post, the same card the portal's Family page
// shows. weekOf is pure, for the tests; readFamilyWeek reads the file.
import { readFile } from "node:fs/promises";
import path from "node:path";

export const BLOG_URL = process.env.BLOG_URL || ""; // your published blog's address; unset: no card (nothing to link to)
export type FamilyWeek = { title: string; summary: string; url: string; to: string };

/** The newest week (by its last day, then its slug) with a title and a slug, or null. */
export function weekOf(raw: unknown, blog = BLOG_URL): FamilyWeek | null {
  if (!blog) return null;
  if (!Array.isArray(raw)) return null;
  const ok = raw.filter((w): w is Record<string, unknown> => !!w && typeof w === "object" && typeof (w as Record<string, unknown>).slug === "string" && typeof (w as Record<string, unknown>).title === "string");
  const key = (w: Record<string, unknown>) => `${String(w.to ?? "")}|${String(w.slug)}`;
  const w = ok.sort((a, b) => (key(a) < key(b) ? 1 : -1))[0];
  if (!w) return null;
  return { title: String(w.title), summary: typeof w.summary === "string" ? w.summary : "", url: `${blog.replace(/\/$/, "")}/family-week/${encodeURIComponent(String(w.slug))}`, to: String(w.to ?? "") };
}

export async function readFamilyWeek(bots: string): Promise<FamilyWeek | null> {
  try {
    return weekOf(JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(bots, "blog", "content", "family-weeks.json"), "utf8")));
  } catch {
    return null;
  }
}
