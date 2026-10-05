import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findBot } from "@/lib/bots";
import VisitsView from "../../../visits-view";

export async function generateMetadata(props: PageProps<"/bots/[slug]/visits">): Promise<Metadata> {
  const bot = await findBot((await props.params).slug);
  return { title: bot ? `${bot.name} pages · Bot Dashboard` : "Bot not found" };
}

export default async function VisitsPage(props: PageProps<"/bots/[slug]/visits">) {
  const bot = await findBot((await props.params).slug);
  if (!bot) notFound();
  return <VisitsView key={bot.slug} bot={bot} />;
}
