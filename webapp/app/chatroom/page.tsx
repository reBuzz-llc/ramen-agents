import { cookies } from "next/headers";
import { listBots } from "@/lib/bots";
import { BOT_PAGE_COOKIE, botBackHref } from "@/lib/view-prefs";
import { currentIdentity } from "@/lib/identity";
import ChatroomView from "../chatroom-view";

export const metadata = { title: "Bot chatroom · Bot Dashboard" };

export default async function ChatroomPage() {
  const [identity, bots, jar] = await Promise.all([currentIdentity(), listBots(), cookies()]);
  // Back returns to the bot you were looking at, the way Settings does.
  const last = bots.find((b) => b.slug === jar.get("bot")?.value) ?? bots[0];
  return <ChatroomView identity={identity} backHref={last ? botBackHref(last.slug, jar.get(BOT_PAGE_COOKIE)?.value) : "/"} backLabel={last?.name ?? "Bots"} />;
}
