import { BOTS_DIR } from "@/lib/bots";
import { readTick } from "@/lib/tick-read";
import TickLine from "../../tick-line";
import { SettingsPage } from "../../settings-ui";
import KeyTabs from "./key-tabs";

export const metadata = { title: "Key providers · Settings" };

export default async function ProvidersPage() {
  const tick = await readTick(BOTS_DIR);
  return (
    <SettingsPage title="Key providers" subtitle="Every provider and key: add, test, delete and mark">
      <TickLine tick={tick} className="mb-4" />
      <KeyTabs />
    </SettingsPage>
  );
}
