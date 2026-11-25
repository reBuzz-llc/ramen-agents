// What the copy icons on a new member's row put on the clipboard, to paste as-is on Slack or WhatsApp, as a
// more useful line than the old copy. Kept apart so the browser side can import it without the
// database code.

/** The address a teammate opens: this site, unless it is someone's own computer (localhost), then the team's public
 *  address, NEXT_PUBLIC_PEEK_PUBLIC_ORIGIN, when the build sets it (filled in at build time, so the browser side sees it
 *  too). Without one, localhost stays: a Peek on one computer has no other address. */
export const liveApp = () => (process.env.NEXT_PUBLIC_PEEK_PUBLIC_ORIGIN?.trim() ?? "").replace(/\/$/, "");
export const publicOrigin = (origin: string) => (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/i.test(origin) ? liveApp() || origin.replace(/\/$/, "") : origin.replace(/\/$/, ""));
export const signInLink = (origin: string) => `${publicOrigin(origin)}/sign-in`;

const first = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/** The invite: who it is for, where to sign in and how, what to do first, who to ask. */
export function copyText(origin: string, o: { email: string; name?: string; ownerName?: string }): string {
  const hi = first(o.name ?? "") ? `Hi ${first(o.name ?? "")}` : "Hi";
  const ask = first(o.ownerName ?? "") ? ` Questions, ask ${first(o.ownerName ?? "")}.` : "";
  return `${hi}, you're set up on Productive Peek, our team's queue and clock. Sign in here: ${signInLink(origin)} — use Continue with Google with ${o.email} (no password needed). First things: clock in on the home page when you start, and open Our queue for the drafts to review and send.${ask}`;
}
