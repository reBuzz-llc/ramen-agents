import { cookies } from "next/headers";
import { listBots } from "@/lib/bots";
import { BOT_PAGE_COOKIE, botBackHref } from "@/lib/view-prefs";
import { currentIdentity } from "@/lib/identity";
import RequestsView from "../requests-view";

export const metadata = { title: "Requests · Bot Dashboard" };

export default async function RequestsPage() {
  const [identity, bots, jar] = await Promise.all([currentIdentity(), listBots(), cookies()]);
  // Back returns to the bot you were looking at, the way Chatroom and Settings do.
  const last = bots.find((b) => b.slug === jar.get("bot")?.value) ?? bots[0];
  return <RequestsView identity={identity} backHref={last ? botBackHref(last.slug, jar.get(BOT_PAGE_COOKIE)?.value) : "/"} backLabel={last?.name ?? "Bots"} />;
}
