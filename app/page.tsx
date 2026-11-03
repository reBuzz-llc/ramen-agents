import ClockView from "./clock/clock-view";
import ManageProjects from "./clock/manage-projects";
import { pageMe } from "@/lib/page-me";

export const metadata = { title: "Clock · ramen-agents" };

// Home is the clock. On a wide screen the Projects panel sits beside it on the right, sticky; on a
// phone it follows the clock.
export default async function Home(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const who = await pageMe();
  const msg = (await props.searchParams).msg;
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <ClockView />
      <aside className="lg:sticky lg:top-6">
        <ManageProjects who={who} msg={typeof msg === "string" ? msg : undefined} />
      </aside>
    </div>
  );
}
