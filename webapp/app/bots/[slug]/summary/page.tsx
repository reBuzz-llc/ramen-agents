import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { findBot } from "@/lib/bots";
import { RANGES, type RangeKey } from "@/lib/summary";
import { RANGE_COOKIE, SCOPE_COOKIE } from "@/lib/view-prefs";
import SummaryView from "../../../summary-view";

export async function generateMetadata(props: PageProps<"/bots/[slug]/summary">): Promise<Metadata> {
  const bot = await findBot((await props.params).slug);
  return { title: bot ? `${bot.name} summary · Bot Dashboard` : "Bot not found" };
}

export default async function SummaryPage(props: PageProps<"/bots/[slug]/summary">) {
  const [{ slug }, query, jar] = await Promise.all([props.params, props.searchParams, cookies()]);
  const bot = await findBot(slug);
  if (!bot) notFound();
  // The address wins; otherwise the period and scope last picked, so switching bots keeps them.
  const asked = typeof query.range === "string" ? query.range : jar.get(RANGE_COOKIE)?.value;
  const range = asked && asked in RANGES ? (asked as RangeKey) : "24h";
  const scope = (typeof query.scope === "string" ? query.scope : jar.get(SCOPE_COOKIE)?.value) === "fleet" ? "fleet" : "bot";
  return <SummaryView key={bot.slug} bot={bot} initialScope={scope} initialRange={range} />;
}
