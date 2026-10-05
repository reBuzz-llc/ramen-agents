import { notFound } from "next/navigation";
import { findBot } from "@/lib/bots";
import { currentIdentity } from "@/lib/identity";
import ChromeShell from "../../chrome-shell";

// The toolbar and tab bar for one bot, shared by its Dashboard, Chat and Persona pages. A layout is not
// re-rendered when you move between those pages, so the navigation stays perfectly still.
export default async function BotLayout(props: LayoutProps<"/bots/[slug]">) {
  const bot = await findBot((await props.params).slug);
  if (!bot) notFound();
  const identity = await currentIdentity();
  return (
    <ChromeShell key={bot.slug} bot={bot} identity={identity}>
      {props.children}
    </ChromeShell>
  );
}
