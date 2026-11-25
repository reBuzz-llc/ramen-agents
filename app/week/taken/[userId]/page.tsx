import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { pageMe } from "@/lib/page-me";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { can } from "@/lib/roles";
import { displayName } from "@/lib/display-name";
import { readTakenFilters } from "@/lib/taken-filters";
import { summaryOf, takenView } from "@/lib/taken-view";
import { getViewPrefs } from "@/lib/view-prefs-db";
import { startDayOf, weekStartDate } from "@/lib/week";
import TakenView from "./taken-view";

export const metadata = { title: "Taken leads · Productive Peek" };

/** One person's taken leads: the leads they hold and the ones they sent this week on the left, the chosen
 *  lead's changes on the right, every person's change named. Yourself, or anyone for the owner and managers,
 *  as on This week. A lead opens in its side panel on this page (?lead=<id>), and the list has filters. */
export default async function TakenPage(props: PageProps<"/week/taken/[userId]">) {
  const who = await pageMe();
  const [{ userId }, sp] = await Promise.all([props.params, props.searchParams]);
  if (userId !== who.userId && !can(who.role, "week.team")) notFound();
  const d = await db();
  const people = await d.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).where(eq(users.tenantId, who.tenantId));
  const person = people.find((p) => p.id === userId);
  if (!person) notFound();
  const [items, view] = await Promise.all([
    takenView(d, who.tenantId, person, people, weekStartDate(new Date(), startDayOf(who.settings), who.settings.timezone)),
    getViewPrefs(d, who.tenantId, who.userId).catch(() => null),
  ]);
  const name = displayName(person.name, person.email);
  const asked = Array.isArray(sp.lead) ? sp.lead[0] : sp.lead;
  const openId = items.some((i) => i.id === asked) ? asked! : null;
  return <TakenView items={items} summary={summaryOf(items)} title={userId === who.userId ? "Your taken leads" : `Taken by ${name}`} holder={name} me={{ userId: who.userId, name: displayName(who.name, who.email) }} view={view} openId={openId} filters={readTakenFilters(sp)} />;
}
