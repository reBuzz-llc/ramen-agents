import { cookies } from "next/headers";
import { BOTS_DIR, listBots } from "@/lib/bots";
import { readTick } from "@/lib/tick-read";
import TickLine from "../../tick-line";
import { SettingsPage } from "../../settings-ui";
import KeyTabs from "./key-tabs";

export const metadata = { title: "Key providers · Settings" };

export default async function ProvidersPage(props: PageProps<"/settings/providers">) {
  const [bots, jar, search, tick] = await Promise.all([listBots(), cookies(), props.searchParams, readTick(BOTS_DIR)]);
  const wanted = typeof search.bot === "string" ? search.bot : jar.get("bot")?.value;
  const bot = bots.find((b) => b.slug === wanted) ?? bots[0];
  return (
    <SettingsPage title="Key providers" subtitle="Every key: availability, usage and limits">
      <TickLine tick={tick} className="mb-4" />
      {bot ? <KeyTabs bots={bots} initial={bot.slug} /> : <p className="text-sm text-muted">No bots found.</p>}
    </SettingsPage>
  );
}
