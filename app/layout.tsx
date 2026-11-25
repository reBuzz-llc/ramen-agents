import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { me, sessionHint } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/roles";
import { draftCount } from "@/lib/samples";
import { readsWith } from "@/lib/session-hint";
import { htmlAttrs, TEXT_COOKIE, THEME_COOKIE } from "@/lib/appearance";
import FreshPages from "./fresh-pages";
import NavLinks from "./nav-links";
import "./globals.css";

export const metadata: Metadata = {
  title: "Productive Peek",
  description: "One queue: agents fill it, people finish it.",
  appleWebApp: { capable: true, title: "Peek", statusBarStyle: "default" },
};

// applebrandkit.md 8: the page reaches the screen's edges (the bars pad themselves), and the browser's own chrome takes
// the page's background colour in each theme.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#14110f" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // the Samples link and its badge, for everyone on the team; the bar never fails on it. Counted
  // alongside the sign-in check, and shown only if that check passes
  const [got, jar] = await Promise.all([readsWith(await sessionHint(), me, async (t) => draftCount(await db(), t.tenantId).catch(() => 0)), cookies()]);
  const who = got?.who ?? null;
  const samples = who && who.acked && can(who.role, "samples.review") ? got!.data : null;
  return (
    <html lang="en" {...htmlAttrs(jar.get(THEME_COOKIE)?.value, jar.get(TEXT_COOKIE)?.value)}>
      <body className="min-h-screen">
        {who ? <FreshPages /> : null}
        <header className="border-b border-line bg-panel pt-[env(safe-area-inset-top)]">
          <nav className="mx-auto flex max-w-5xl items-center gap-x-3 max-[379px]:gap-x-1 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] text-sm sm:gap-x-5 sm:px-5">
            <Link href="/" className="mr-1 inline-flex min-h-12 max-[379px]:hidden shrink-0 items-center font-semibold whitespace-nowrap text-ink sm:mr-2">
              <span className="sm:hidden">Peek</span>
              <span className="hidden sm:inline">Productive Peek</span>
            </Link>
            {who ? (
              <NavLinks who={{ name: who.name, email: who.email, role: who.role, tenantName: who.tenantName }} samples={samples} />
            ) : (
              <Link href="/privacy" className="ml-auto inline-flex min-h-12 items-center text-muted hover:text-ink">
                Privacy
              </Link>
            )}
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-5 pt-8 has-[[data-wide]]:max-w-none pb-[max(2rem,env(safe-area-inset-bottom))]">{children}</main>
      </body>
    </html>
  );
}
