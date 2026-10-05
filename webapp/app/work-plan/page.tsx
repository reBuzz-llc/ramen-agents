import { cookies } from "next/headers";
import { listBots } from "@/lib/bots";
import { BOT_PAGE_COOKIE, botBackHref } from "@/lib/view-prefs";
import { currentIdentity } from "@/lib/identity";
import WorkPlanView from "../work-plan-view";

export const metadata = { title: "Work plan · Bot Dashboard" };

export default async function WorkPlanPage() {
  const [identity, bots, jar] = await Promise.all([currentIdentity(), listBots(), cookies()]);
  // Back returns to the bot page you were on, the way Chatroom, Requests and Settings do.
  const last = bots.find((b) => b.slug === jar.get("bot")?.value) ?? bots[0];
  return <WorkPlanView identity={identity} backHref={last ? botBackHref(last.slug, jar.get(BOT_PAGE_COOKIE)?.value) : "/"} backLabel={last?.name ?? "Bots"} />;
}
