// The Family page's week card links to a post on the public blog. The blog can be down for days, so the card shows
// the link only after the exact page answered 200. The check runs after the response, at most once an hour for a link, and only
// ever asks the blog's own address: the link comes from a stored report, and the server must not fetch wherever one points.

const HOUR = 3_600_000;
const WAIT_MS = 5_000;
const KEEP = 50;
/** The host the team's weekly post is on (NEXT_PUBLIC_PEEK_BLOG_HOST); without it no link is checked, so none shows as open. */
const blogHost = () => process.env.NEXT_PUBLIC_PEEK_BLOG_HOST?.trim().toLowerCase() ?? "";

type Seen = { ok: boolean; at: number };
const g = globalThis as { __peekWeekLinks?: Map<string, Seen> };
const seen = () => (g.__peekWeekLinks ??= new Map<string, Seen>());

function note(url: string, ok: boolean, at: number) {
  const all = seen();
  all.delete(url);
  all.set(url, { ok, at });
  while (all.size > KEEP) all.delete(all.keys().next().value!);
}

function isBlogLink(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !!blogHost() && u.hostname === blogHost() && !u.port && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** What the last check found; false before the first answer. */
export const weekLinkOk = (url: string): boolean => seen().get(url)?.ok === true;

/** Ask the blog for this exact page unless it was asked within the hour. Only a 200 counts; a redirect is not followed. */
export async function checkWeekLink(url: string, get: typeof fetch = fetch, now = Date.now()): Promise<boolean> {
  const had = seen().get(url);
  if (had && now - had.at < HOUR) return had.ok;
  if (!isBlogLink(url)) {
    note(url, false, now);
    return false;
  }
  note(url, had?.ok ?? false, now); // the hour starts now, so a second page load does not ask again while this one waits
  let ok = false;
  try {
    const r = await get(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(WAIT_MS) });
    ok = r.status === 200;
    r.body?.cancel().catch(() => undefined);
  } catch {
    ok = false;
  }
  note(url, ok, now);
  return ok;
}
