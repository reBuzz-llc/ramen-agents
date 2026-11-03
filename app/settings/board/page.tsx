import { notFound } from "next/navigation";
import { pageMe } from "@/lib/page-me";
import { db } from "@/lib/db";
import { can } from "@/lib/roles";
import { queueOf, type NotionPage } from "@/lib/queue";
import { boardById } from "@/lib/notion";
import { cachedBoard, nameBoards, notionOf } from "@/lib/tenants";
import { settingsTitle } from "@/lib/settings-nav";
import { helper } from "@/lib/ui-classes";
import NotionBox, { type Connected } from "../notion-box";
import SectionHead from "../section-head";

export const metadata = { title: settingsTitle("board") };

export default async function Board(props: PageProps<"/settings/board">) {
  const who = await pageMe("/settings/board");
  if (!can(who.role, "settings.notion")) notFound();
  const msg = (await props.searchParams).msg;
  const d = await db();
  const [conn, cache] = await Promise.all([notionOf(d, who.tenantId).catch(() => null), cachedBoard(d, who.tenantId)]);
  let notion = conn;
  if (notion && (!notion.leadsTitle || (notion.tasks && !notion.tasksTitle))) {
    // Titles missing: ask Notion once and keep them; a refusal leaves the card naming the boards generically.
    const [l, t] = await Promise.all([boardById(notion.token, notion.leads), notion.tasks ? boardById(notion.token, notion.tasks) : null]).catch(() => [null, null]);
    if (l) {
      await nameBoards(d, who.tenantId, l.title, t?.title ?? null);
      notion = { ...notion, leadsTitle: l.title, tasksTitle: t?.title ?? null };
    }
  }
  const connected: Connected | null = notion
    ? {
        leads: notion.leads,
        tasks: notion.tasks,
        leadsTitle: notion.leadsTitle,
        tasksTitle: notion.tasksTitle,
        as: notion.integrationName,
        devFile: notion.fromDevFile,
        lastRefresh: cache.lastRefresh?.toISOString() ?? null,
        queued: queueOf(cache.rows as unknown as NotionPage[]).length,
      }
    : null;
  return (
    <>
      <SectionHead slug="board" msg={msg} />
      <section aria-label="Notion board">
        <p className={helper}>ramen-agents reads the board and writes only a row&apos;s Status, when someone clicks. The board moves into this app later; this page will then show that board.</p>
        <NotionBox connected={connected} />
      </section>
    </>
  );
}
