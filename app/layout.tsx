import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { me } from "@/lib/auth";
import { htmlAttrs, TEXT_COOKIE, THEME_COOKIE } from "@/lib/appearance";
import NavLinks from "./nav-links";
import "./globals.css";

export const metadata: Metadata = {
  title: "ramen-agents",
  description: "One queue: agents fill it, people finish it.",
  appleWebApp: { capable: true, title: "ramen", statusBarStyle: "default" },
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
  const [who, jar] = await Promise.all([me(), cookies()]);
  return (
    <html lang="en" {...htmlAttrs(jar.get(THEME_COOKIE)?.value, jar.get(TEXT_COOKIE)?.value)}>
      <body className="min-h-screen">
        <header className="border-b border-line bg-panel pt-[env(safe-area-inset-top)]">
          <nav className="mx-auto flex max-w-5xl items-center gap-x-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] text-sm sm:gap-x-5 sm:px-5">
            <Link href="/" className="mr-1 inline-flex min-h-12 shrink-0 items-center font-semibold whitespace-nowrap text-ink sm:mr-2">
              <span className="sm:hidden">ramen</span>
              <span className="hidden sm:inline">ramen-agents</span>
            </Link>
            {who ? (
              <NavLinks who={{ name: who.name, email: who.email, role: who.role, tenantName: who.tenantName }} />
            ) : (
              <Link href="/privacy" className="ml-auto inline-flex min-h-12 items-center text-muted hover:text-ink">
                Privacy
              </Link>
            )}
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-5 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))]">{children}</main>
      </body>
    </html>
  );
}
