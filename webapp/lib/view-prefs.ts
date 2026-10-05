// What the owner last chose on a page, remembered in a cookie so it survives switching bots and coming
// back later. Plain constants with no server imports, so both the client views and the server pages can
// use them (lib/summary.ts reads the bots' databases and cannot be imported from the browser).

/** The Summary tab's period: 24h | 7d | 30d | 90d. */
export const RANGE_COOKIE = "range";
/** The Summary tab's scope: "bot" or "fleet". */
export const SCOPE_COOKIE = "summary-scope";
/** The page of a bot last open ("", summary, chat, persona, screenshots, visits), so Back from Settings, the
 * chatroom or Requests returns there rather than to the dashboard. */
export const BOT_PAGE_COOKIE = "bot-page";

/** Where Back goes for a bot: its last page when that is a known one, else its dashboard. */
export function botBackHref(slug: string, page: string | undefined): string {
  return `/bots/${slug}${page && /^(summary|chat|persona|screenshots|visits)$/.test(page) ? `/${page}` : ""}`;
}
