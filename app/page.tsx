import { Suspense } from "react";
import ClockView from "./clock/clock-view";
import type { Day } from "./clock/clock-view";
import ManageProjects from "./clock/manage-projects";
import { sessionHint, type Me } from "@/lib/auth";
import { clockDay } from "@/lib/clock-day";
import { pageMe } from "@/lib/page-me";
import { readsWith } from "@/lib/session-hint";
import PixelLoader from "./pixel-loader";
import GoalsNudge from "./goals-nudge";
import SendPack from "./send-pack";
import FollowUps from "./follow-ups";
import SamplesToMake from "./samples-to-make";
import { samplesToMake } from "@/lib/samples-to-make";
import PackTabs from "./pack-tabs";
import WhatsAppPack from "./whatsapp-pack";
import { CHECK, checkList, heldSendList, sendList } from "@/lib/whatsapp-pack";
import { followUpsDue, sentWaiting } from "@/lib/follow-up";
import { db } from "@/lib/db";
import { can } from "@/lib/roles";
import { allPacks, heldPack, PACK, packOf } from "@/lib/send-pack";
import { displayName, namesOf } from "@/lib/display-name";
import { todayOf } from "@/lib/send-goals-db";
import { goalLine, goalsChanged, goalsOf } from "@/lib/send-goals";
import { getViewPrefs } from "@/lib/view-prefs-db";
import GoalsBanner from "./goals-banner";

export const metadata = { title: "Clock · Productive Peek" };

// Home is the clock. On a wide screen the Projects panel sits beside it on the right, sticky; on a
// phone it follows the clock. Above it, the owner's nudge while no key results are set;
// under the clock, the person's send pack, and for the owner everyone's; then their follow-ups due and their
// sends waiting for an answer, with the result chips. The pack has an Email and a WhatsApp side.
export default async function Home(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // The clock is read first and can be used at once; the send pack and the projects arrive under it as they are read. The dismissed-goals read comes with the sign-in check, so the banner never pushes
  // the clock down afterwards.
  const got = await readsWith(await sessionHint(), () => pageMe(), ({ tenantId, userId }) => db().then((d) => getViewPrefs(d, tenantId, userId)).catch(() => null));
  const { who, data: view } = got!;
  const msg = (await props.searchParams).msg;
  const work = can(who.role, "queue.work");
  const changed = work ? goalsChanged(who.settings, view?.goals_seen) : null;
  // the clock's own day first, so Clock in does not queue behind the long lists; as JSON, the shape /api/clock answers
  const first = await clockDay(await db(), who.tenantId, who.userId, who.settings)
    .then((day) => JSON.parse(JSON.stringify({ ...day, canDeleteAny: who.role !== "member" })) as Day)
    .catch(() => undefined);
  return (
    <>
      <GoalsNudge role={who.role} keyResults={who.settings.keyResults} className="mb-6" />
      {changed ? <GoalsBanner at={changed.at} text={changed.text} /> : null}
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0">
          <ClockView first={first} />
          {work ? (
            <Suspense fallback={<div className="mt-6"><PixelLoader active label="Loading your send pack…" /></div>}>
              <WorkSections who={who} />
            </Suspense>
          ) : null}
        </div>
        <aside className="lg:sticky lg:top-6">
          <Suspense fallback={null}>
            <ManageProjects who={who} msg={typeof msg === "string" ? msg : undefined} />
          </Suspense>
        </aside>
      </div>
    </>
  );
}

/** Everything under the clock for someone who works the leads: the send pack, the goal line, samples to make and follow-ups. */
async function WorkSections({ who }: { who: Me }) {
  const d = await db();
  const myName = displayName(who.name, who.email);
  // today's send goals first: the WhatsApp list reuses the count instead of asking again
  const todayP = todayOf(d, who.tenantId, who.userId, new Date(), who.settings);
  // the same list as the Follow up tab, and the waiting list leaves out what it holds
  const dueP = followUpsDue(d, who.tenantId, namesOf(who.name, who.email));
  const [pack, others, due, waiting, checks, waSend, samples, today, packHeld, waHeld] = await Promise.all([
    packOf(d, who.tenantId, who.userId),
    who.role === "owner" ? allPacks(d, who.tenantId) : null,
    dueP,
    sentWaiting(d, who.tenantId, namesOf(who.name, who.email), new Date(), dueP),
    checkList(d, who.tenantId, who.userId),
    sendList(d, who.tenantId, who.userId),
    samplesToMake(d, who.tenantId, namesOf(who.name, who.email)),
    todayP,
    // leads off the send lists, each with the reason
    heldPack(d, who.tenantId, who.userId),
    heldSendList(d, who.tenantId, who.userId),
  ]);
  return (
    <>
      <PackTabs
        email={<SendPack pack={pack} held={packHeld} size={PACK} me={myName} others={others} today={today.email} />}
        whatsapp={
          <section aria-label="WhatsApp">
            <WhatsAppPack checks={checks} send={waSend} held={waHeld} size={CHECK} today={today.whatsapp} />
          </section>
        }
        waCount={waSend.filter((l) => l.draft).length}
      />
      {/* the goal, from the live settings, for everyone */}
      <p data-goal-line className="mt-3 text-sm text-muted">
        {goalLine(goalsOf(who.settings))}
      </p>
      <SamplesToMake rows={samples} />
      <FollowUps due={due} waiting={waiting} />
    </>
  );
}
