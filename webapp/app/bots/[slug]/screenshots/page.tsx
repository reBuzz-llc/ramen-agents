import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findBot } from "@/lib/bots";
import ScreenshotGrid from "../../../screenshot-grid";

export async function generateMetadata(props: PageProps<"/bots/[slug]/screenshots">): Promise<Metadata> {
  const bot = await findBot((await props.params).slug);
  return { title: bot ? `${bot.name} screenshots · Bot Dashboard` : "Bot not found" };
}

export default async function ScreenshotsPage(props: PageProps<"/bots/[slug]/screenshots">) {
  const bot = await findBot((await props.params).slug);
  if (!bot) notFound();
  return <ScreenshotGrid key={bot.slug} bot={bot} />;
}
