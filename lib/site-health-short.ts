// How the Site health cell reads on the Leads pages: only the short facts (such as © 2022 · 1.1s to load), the rest left out. Display only. The stored text, the /v1 API, exports and what the agents read stay as they are.

const YEAR = /©\s*((?:19|20)\d{2})\b/;
const LOAD = /(?<![\d.])(\d+(?:\.\d+)?)s to load\b/;

/** A short word for a row with neither part. Off: the owner chose to leave those cells blank. Turning it on is this one line. */
export const SHOW_HEALTH_STATUS = false;

/** "no website" or "site down", for a row with no year and no load time; "" when the text says neither. */
export function healthStatus(raw: string): string {
  if (/^\s*no website\b/i.test(raw)) return "no website";
  if (/\b(blocks bots|blocked|down|unreachable|timed? ?out|http \d{3})\b/i.test(raw)) return "site down";
  return "";
}

/** "© 2022 · 1.1s to load", or the one part that is known, or nothing. */
export function siteHealthShort(raw: string | null | undefined, withStatus = SHOW_HEALTH_STATUS): string {
  const text = raw ?? "";
  const year = YEAR.exec(text)?.[1];
  const load = LOAD.exec(text)?.[1];
  const parts = [year ? `© ${year}` : "", load ? `${load}s to load` : ""].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  return withStatus ? healthStatus(text) : "";
}
