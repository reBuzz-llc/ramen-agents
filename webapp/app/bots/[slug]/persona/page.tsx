import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findBot } from "@/lib/bots";
import PersonaEditor from "../../../persona-editor";

export async function generateMetadata(props: PageProps<"/bots/[slug]/persona">): Promise<Metadata> {
  const bot = await findBot((await props.params).slug);
  return { title: bot ? `${bot.name} persona · Bot Dashboard` : "Bot not found" };
}

export default async function PersonaPage(props: PageProps<"/bots/[slug]/persona">) {
  const bot = await findBot((await props.params).slug);
  if (!bot) notFound();
  return <PersonaEditor key={bot.slug} bot={bot} />;
}
