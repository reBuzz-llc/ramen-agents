import { after } from "next/server";
import { db } from "@/lib/db";
import { latestReports, type Stored } from "@/lib/family";
import { pageMe } from "@/lib/page-me";
import { displayName } from "@/lib/display-name";
import { checkWeekLink, weekLinkOk } from "@/lib/week-link";
import { worldBase, worldLink } from "@/lib/world-share";
import LiveWorld from "./live-world";
import { WeekCard } from "./week-card";

export const metadata = { title: "Team · Productive Peek" };

// The agent family for the team: the live world on top (the owner's machine)
// and, under it, the newest "This week in the family" post. Nothing on this page is edited by a person. The day's
// numbers, the member lines and the morning lines are still posted and kept (POST /v1/family/report, GET
// /v1/family/latest) for later; the world shows the members now.
type Week = Extract<Stored, { kind: "week" }>;

export default async function FamilyPage() {
  const who = await pageMe();
  const latest = await latestReports(await db(), who.tenantId);
  const week = latest.week as Week | null;
  // the week's public page is checked after this response, at most once an hour
  if (week) after(() => checkWeekLink(week.week.url));
  const base = worldBase(who.settings.worldUrl);
  // the live world: a link signed for this person per page load, when the owner saved the address
  const world = worldLink(base, process.env.WORLD_SHARE_SECRET, displayName(who.name, who.email));
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">Team</h1>
      <p className="mt-1 text-sm text-muted">The agents at work, live and read-only, and their week. Businesses show by first word and initial; no addresses or numbers.</p>
      {world ? <LiveWorld src={world} /> : <p data-world="unset" className="mt-6 rounded-lg bg-panel p-4 text-sm text-muted">The live world appears here once the owner connects it.</p>}

      <section aria-labelledby="family-week" className="mt-8">
        <h2 id="family-week" className="text-lg font-semibold">
          This week in the Team
        </h2>
        {week ? (
          <WeekCard week={week.week} available={weekLinkOk(week.week.url)} />
        ) : (
          <p className="mt-3 rounded-lg bg-panel p-4 text-sm text-muted">No week written yet: the agents post one each Sunday.</p>
        )}
      </section>
    </div>
  );
}
