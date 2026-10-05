import { cookies } from "next/headers";
import { listBots } from "@/lib/bots";
import { BOT_PAGE_COOKIE, botBackHref } from "@/lib/view-prefs";
import { currentIdentity } from "@/lib/identity";
import SettingsShell from "../settings-shell";

export const metadata = { title: "Settings · Bot Dashboard" };

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const [identity, bots, jar] = await Promise.all([currentIdentity(), listBots(), cookies()]);
  // Back returns to the bot you were looking at (the dashboard remembers it in a cookie).
  const last = bots.find((b) => b.slug === jar.get("bot")?.value) ?? bots[0];
  return (
    <SettingsShell identity={identity} backHref={last ? botBackHref(last.slug, jar.get(BOT_PAGE_COOKIE)?.value) : "/"} backLabel={last?.name ?? "Bots"}>
      {children}
    </SettingsShell>
  );
}
