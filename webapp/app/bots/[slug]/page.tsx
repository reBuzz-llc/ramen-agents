import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findBot } from "@/lib/bots";
import Dashboard from "../../dashboard";

export async function generateMetadata(props: PageProps<"/bots/[slug]">): Promise<Metadata> {
  const bot = await findBot((await props.params).slug);
  return { title: bot ? `${bot.name} · Bot Dashboard` : "Bot not found" };
}

export default async function BotPage(props: PageProps<"/bots/[slug]">) {
  const bot = await findBot((await props.params).slug);
  if (!bot) notFound();
  // key: switching bots starts every panel fresh instead of showing the last bot's data.
  return <Dashboard key={bot.slug} bot={bot} />;
}
