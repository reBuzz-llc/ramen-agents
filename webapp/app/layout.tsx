import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { GLASS_COOKIE, GLASS_DEFAULT, parseGlass, parseTheme, THEME_COLORS, THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bot Dashboard",
  description: "Watch what each bot on this Mac is doing, reading, and thinking.",
  applicationName: "Bots",
  // Add to Home Screen on iPhone and iPad: full-screen, with the status bar over the page's glass top bar.
  appleWebApp: { capable: true, title: "Bots", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false, email: false, address: false },
};

export async function generateViewport(): Promise<Viewport> {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return {
    width: "device-width",
    initialScale: 1,
    // Draw under the notch, Dynamic Island and home indicator; the bars pad themselves with safe-area insets.
    viewportFit: "cover",
    colorScheme: theme === "system" ? "light dark" : theme,
    themeColor:
      theme === "system"
        ? [
            { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
            { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
          ]
        : THEME_COLORS[theme],
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const jar = await cookies();
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  const glass = parseGlass(jar.get(GLASS_COOKIE)?.value);
  return (
    <html
      lang="en"
      className="h-full"
      data-theme={theme === "system" ? undefined : theme}
      style={glass === GLASS_DEFAULT ? undefined : ({ "--glass-t": String(glass / 100) } as React.CSSProperties)}
      suppressHydrationWarning
    >
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
