// The browser remembers a visited page for a short while, so going back to it is instant. Two rules keep that honest:
// a person's own save clears the memory at once, and a remembered page with send or reply marks is read
// again in the background the moment it is shown, so a teammate's mark appears within about a second. Other pages may show a
// teammate's change up to 30 seconds late. next.config.ts uses the same number.
export const REMEMBER_SECONDS = 30;

/** A save by this browser to Peek's own API that went through. */
export function isOwnWrite(input: unknown, init: { method?: string } | undefined, origin: string): boolean {
  const req = typeof Request !== "undefined" && input instanceof Request ? input : null;
  const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  try {
    const u = new URL(req ? req.url : String(input), origin);
    return u.origin === origin && u.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/** The page being opened may be the remembered copy: it was left inside the window. */
export const mayBeRemembered = (leftAt: number | undefined, now: number) => leftAt !== undefined && now - leftAt < REMEMBER_SECONDS * 1000;

/** The pages that show send and reply marks. Only these are read again on return, because a read-again clears the browser's
 *  memory of every other page. */
const MARK_PAGES = new Set(["/", "/leads"]);
export const readAgainOnReturn = (path: string, leftAt: number | undefined, now: number) => MARK_PAGES.has(path) && mayBeRemembered(leftAt, now);
