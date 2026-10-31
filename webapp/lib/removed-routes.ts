// Pages the owner removed on 2026-10-30: the world at / and the Work plan replace them. Each old
// address redirects to / so a saved link or a bookmark never ends on a 404. next.config.ts reads this list.
export const REMOVED_ROUTES = ["/bots/:path*", "/chatroom", "/requests", "/send-today", "/family-review"] as const;

/** Whether a path is one of the removed pages (what the redirects above match). */
export function isRemoved(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return p === "/bots" || p.startsWith("/bots/") || ["/chatroom", "/requests", "/send-today", "/family-review"].includes(p);
}
