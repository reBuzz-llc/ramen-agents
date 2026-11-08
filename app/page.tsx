import ClockView from "./clock/clock-view";
import ManageProjects from "./clock/manage-projects";
import { pageMe } from "@/lib/page-me";
import GoalsNudge from "./goals-nudge";
import SendPack from "./send-pack";
import FollowUps from "./follow-ups";
import { followUpsDue, sentWaiting } from "@/lib/follow-up";
import { db } from "@/lib/db";
import { can } from "@/lib/roles";
import { allPacks, PACK, packOf } from "@/lib/send-pack";

export const metadata = { title: "Clock · ramen-agents" };

// Home is the clock. On a wide screen the Projects panel sits beside it on the right, sticky; on a phone it follows the
// clock. Above it, the owner's nudge while no key results are set; under the clock, the person's send pack (and for the
// owner everyone's), then their follow-ups due and their sends waiting for an answer, with the result chips.
export default async function Home(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const who = await pageMe();
  const msg = (await props.searchParams).msg;
  const d = await db();
  const work = can(who.role, "queue.work");
  const myName = who.name || who.email;
  const [pack, others, due, waiting] = await Promise.all([
    work ? packOf(d, who.tenantId, who.userId) : [],
    who.role === "owner" ? allPacks(d, who.tenantId) : null,
    work ? followUpsDue(d, who.tenantId, myName) : [],
    work ? sentWaiting(d, who.tenantId, myName) : [],
  ]);
  return (
    <>
      <GoalsNudge role={who.role} keyResults={who.settings.keyResults} className="mb-6" />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0">
          <ClockView />
          {work ? <SendPack pack={pack} size={PACK} me={myName} others={others} /> : null}
          {work ? <FollowUps due={due} waiting={waiting} /> : null}
        </div>
        <aside className="lg:sticky lg:top-6">
          <ManageProjects who={who} msg={typeof msg === "string" ? msg : undefined} />
        </aside>
      </div>
    </>
  );
}
