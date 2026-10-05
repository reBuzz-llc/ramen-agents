import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findBot } from "@/lib/bots";
import ChatView from "../../../chat-view";

export async function generateMetadata(props: PageProps<"/bots/[slug]/chat">): Promise<Metadata> {
  const bot = await findBot((await props.params).slug);
  return { title: bot ? `Chat with ${bot.name} · Bot Dashboard` : "Bot not found" };
}

export default async function ChatPage(props: PageProps<"/bots/[slug]/chat">) {
  const bot = await findBot((await props.params).slug);
  if (!bot) notFound();
  return <ChatView key={bot.slug} bot={bot} />;
}
