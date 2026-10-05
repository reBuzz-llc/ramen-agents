import { cookies } from "next/headers";
import { listBots } from "@/lib/bots";
import { SettingsPage } from "../../settings-ui";
import KeyTabs from "./key-tabs";

export const metadata = { title: "Key providers · Settings" };

export default async function ProvidersPage(props: PageProps<"/settings/providers">) {
  const [bots, jar, search] = await Promise.all([listBots(), cookies(), props.searchParams]);
  const wanted = typeof search.bot === "string" ? search.bot : jar.get("bot")?.value;
  const bot = bots.find((b) => b.slug === wanted) ?? bots[0];
  return (
    <SettingsPage title="Key providers" subtitle="Every key: availability, usage and limits">
      {bot ? <KeyTabs bots={bots} initial={bot.slug} /> : <p className="text-sm text-muted">No bots found.</p>}
    </SettingsPage>
  );
}
