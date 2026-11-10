import { db } from "@/lib/db";
import { latestReports, olderThan, type Stored } from "@/lib/family";
import { pageMe } from "@/lib/page-me";
import { displayName } from "@/lib/display-name";
import { worldBase, worldLink } from "@/lib/world-share";
import LiveWorld from "./live-world";

export const metadata = { title: "Family · ramen-agents" };

// The agent family's day and week for the team, the reverse of the Guide: what the agents did,
// posted by the Validator (POST /v1/family/report) and shown here as it came. Nothing on this page is edited by a person.
type Tick = Extract<Stored, { kind: "tick" }>;
type Morning = Extract<Stored, { kind: "morning" }>;
type Week = Extract<Stored, { kind: "week" }>;

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });

function Section({ title, at, children }: { title: string; at?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold">
        {title}
        {at ? <span className="text-xs font-normal text-muted">as of {when(at)}</span> : null}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const STATE_TONE: Record<string, string> = { working: "bg-accent/15 text-ink", resting: "bg-panel text-muted", stopped: "bg-panel text-muted" };

export default async function FamilyPage() {
  const who = await pageMe();
  const latest = await latestReports(await db(), who.tenantId);
  const tick = latest.tick as Tick | null;
  const morning = latest.morning as Morning | null;
  const week = latest.week as Week | null;
  const t = tick?.today ?? {};
  const tiles: { label: string; value: string | null }[] = [
    { label: "Drafts landed", value: t.drafts_landed === undefined ? null : String(t.drafts_landed) },
    { label: "WhatsApp pitches", value: t.whatsapp_pitches === undefined ? null : String(t.whatsapp_pitches) },
    { label: "Leads listed", value: t.leads_listed === undefined ? null : String(t.leads_listed) },
    { label: "No website", value: t.no_site_share === undefined ? null : `${t.no_site_share}%` },
    { label: "Drafts polished", value: t.polished_drafts === undefined ? null : String(t.polished_drafts) },
  ];
  const roles = Object.entries(t.contact_roles ?? {}).sort((a, b) => b[1] - a[1]);
  const stale = tick ? olderThan(tick.at, 30) : false;
  // the live office on top: a link signed for this person per page load, when the owner saved the address
  const world = worldLink(worldBase(who.settings.worldUrl), process.env.WORLD_SHARE_SECRET, displayName(who.name, who.email));
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">Family</h1>
      <p className="mt-1 text-sm text-muted">What the agents did today and this week, as they report it. The Guide is what you do; this is what they do. Names of businesses and people are left out.</p>
      {world ? <LiveWorld src={world} /> : null}
      {!tick && !morning && !week ? (
        <p className="mt-6 rounded-lg bg-panel p-4 text-sm text-muted">No report from the agents yet. Once the Validator is connected it posts here every few minutes.</p>
      ) : null}

      {tick ? (
        <Section title="Today" at={tick.at}>
          {stale ? <p className="mb-3 text-sm text-bad">This is more than 30 minutes old: the agents may be paused, or the Validator has stopped reporting.</p> : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {tiles.map((x) => (
              <div key={x.label} className="rounded-xl border border-line bg-panel p-4">
                <p className="text-xs text-muted">{x.label}</p>
                <p className="text-2xl font-semibold tabular-nums">{x.value ?? "–"}</p>
              </div>
            ))}
          </div>
          {roles.length ? (
            <p className="mt-3 text-sm">
              <span className="text-muted">Contact roles found: </span>
              {roles.map(([r, n]) => `${r} ${n}`).join(" · ")}
            </p>
          ) : null}
        </Section>
      ) : null}

      {tick?.members.length ? (
        <Section title="The agents now" at={tick.at}>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {tick.members.map((m) => (
              <li key={m.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="font-medium">{m.name}</span>
                {m.state ? <span className={`rounded-full px-2 py-0.5 text-xs ${STATE_TONE[m.state] ?? "bg-panel text-muted"}`}>{m.state}</span> : null}
                <span className="min-w-0 flex-1 text-sm text-muted">{m.line}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {morning ? (
        <Section title="This morning" at={morning.at}>
          <ul className="space-y-1 text-sm">
            {morning.lines.map((l, i) => (
              <li key={i} className="whitespace-pre-wrap">
                {l}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {week ? (
        <Section title="This week">
          <a href={week.week.url} target="_blank" rel="noopener" className="block rounded-xl border border-line bg-panel p-4 hover:border-accent">
            <p className="font-semibold">{week.week.title}</p>
            {week.week.summary ? <p className="mt-1 text-sm text-muted">{week.week.summary}</p> : null}
            <p className="mt-2 text-sm font-medium text-accent">Read the week →</p>
          </a>
        </Section>
      ) : null}
    </div>
  );
}
