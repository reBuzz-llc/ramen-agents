import { agentName } from "@/lib/agent-names";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sessionHint } from "@/lib/auth";
import { db } from "@/lib/db";
import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import { references } from "@/lib/sample-references";
import { openTakedown } from "@/lib/sample-takedowns";
import { CARD_LABEL, FREE_STORAGE, REVIEW_GROUPS, reviewOf, sampleCards, storageUse, type ReviewGroup, type SampleCard, type StorageUse } from "@/lib/samples";
import { readsWith } from "@/lib/session-hint";
import { missingAgent, missingLine, teamAgents } from "@/lib/agent-presence";
import { pageLead, pageTitle } from "@/lib/ui-classes";
import { CARD_TONE as TONE, storageFull, storageLine } from "@/lib/sample-labels";
import SampleDetail from "./sample-cards";

export const metadata = { title: "Samples · Productive Peek", robots: { index: false } };

// Samples, a review screen. The list on the left, what needs you first -- drafts
// waiting for a yes, then what the Site Builder is working on, what is live or approved, and what is done (folded) -- each
// with one line saying why it is there; the chosen sample on the right at its real size with its decisions and rows
// (sample-cards.tsx). On a phone the list comes first and a sample opens on its own, its decisions in a bar along the
// bottom. Everyone on the team sees it; the lead's Sample box stays as it is. can(who.role,
// "samples.review") guards the page; the Reference mark and the storage line keep their own, narrower checks.
export default async function SamplesPage({ searchParams }: { searchParams: Promise<{ s?: string; status?: string }> }) {
  const d = await db();
  // The list is read alongside the sign-in check and used only if it passes; the owner's storage line starts the moment
  // the check says this is the owner
  const storage: { read?: Promise<StorageUse | null> } = {};
  const got = await readsWith(
    await sessionHint(),
    async () => {
      const w = await pageMe("/samples");
      if (w.role === "owner") storage.read = storageUse(d, w.tenantId).catch(() => null);
      return w;
    },
    ({ tenantId }) => Promise.all([sampleCards(d, tenantId), references(d, tenantId), teamAgents(d, tenantId).catch(() => null)]),
  );
  if (!got) notFound();
  const { who } = got;
  if (!can(who.role, "samples.review")) notFound();
  const [{ cards, total }, refs, agents] = got.data;
  // a team without a Site Builder: one line says where samples come from (lib/agent-presence.ts)
  const builderMissing = missingAgent(agents, "Site Builder");
  const q = await searchParams;
  const owner = who.role === "owner";
  const use = (await storage.read) ?? null;
  // the owner's reference marks, each pinned to a version
  const marks = Object.fromEntries(refs.references.map((r) => [r.sampleId, { version: r.version, family: r.family, setAt: r.setAt, setBy: r.setBy }]));
  const placed = cards.map((c) => ({ c, ...reviewOf(c, who.settings.samplesPublishPolledAt ?? null) }));
  const groups = REVIEW_GROUPS.map((g) => ({ ...g, items: placed.filter((x) => x.group === g.key) }));
  // the chosen sample: ?s=<id>, else the first that needs you (on a computer); none on a phone until one is tapped
  const chosen = placed.find((x) => x.c.id === q.s) ?? null;
  const shown = chosen ?? groups.find((g) => g.items.length && g.key !== "done")?.items[0] ?? null;
  const href = (id: string) => `/samples?s=${encodeURIComponent(id)}`;
  // on a computer the title sits over the list only, so the sample and its preview start level with it
  const heading = (
    <>
      <h1 className={pageTitle}>Samples</h1>
      <p className={pageLead}>Sample sites for no-site leads. What needs you is at the top; pick one to see it at its real size, then approve it or ask for changes.</p>
      {builderMissing ? (
        <p data-agent-missing className="mt-1 text-sm text-muted">
          {missingLine("Sample sites", builderMissing)}
        </p>
      ) : null}
      {/* the owner sees how full the free file storage is (read only) */}
      {use ? (
        <p data-storage className={`mt-1 text-sm ${storageFull(use, FREE_STORAGE) ? "font-semibold text-bad" : "text-muted"}`}>
          {storageLine(use, FREE_STORAGE)}
        </p>
      ) : null}
      {total > cards.length ? (
        <p data-samples-cut className="mt-1 text-sm text-muted">
          Showing {cards.length.toLocaleString()} of {total.toLocaleString()} samples. Older finished ones are left out of this list.
        </p>
      ) : null}
    </>
  );
  return (
    <div data-wide className="mx-auto max-w-[90rem]">
      {cards.length ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-5 md:grid-cols-[17rem_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr] xl:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="min-w-0 md:col-span-2 lg:col-span-1 lg:col-start-1 lg:row-start-1" data-samples-heading>{heading}</div>
          <nav aria-label="Samples" className={`${chosen ? "hidden md:block" : ""} min-w-0 md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:self-start md:overflow-y-auto lg:col-start-1 lg:row-start-2`} data-sample-list>
            {groups.map((g) =>
              g.items.length ? (
                <ListGroup key={g.key} group={g.key} label={g.label} items={g.items} current={shown?.c.id ?? ""} href={href} />
              ) : g.key === "needs" ? (
                <p key={g.key} className="mb-4 rounded-lg bg-panel px-3 py-2 text-sm text-muted">
                  Nothing needs you right now.
                </p>
              ) : null,
            )}
          </nav>
          <div className={`min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 ${chosen ? "" : "hidden md:block"}`}>
            {shown ? (
              <SampleDetail key={shown.c.id} c={shown.c} isOwner={owner} canMark={can(who.role, "samples.reference")} viewer={{ role: who.role, userId: who.userId }} mark={marks[shown.c.id] ?? null} takedown={openTakedown(who.settings.sampleTakedowns, shown.c.id)} backHref="/samples" publishPolledAt={who.settings.samplesPublishPolledAt ?? null} />
            ) : (
              <p className="rounded-lg bg-panel p-4 text-sm text-muted">Pick a sample on the left.</p>
            )}
          </div>
        </div>
      ) : (
        <>
          {heading}
        <p className="mt-6 rounded-lg bg-panel p-4 text-sm text-muted">No samples yet. The {agentName("Site Builder")} drafts one for a no-site lead; it shows here for a person to check.</p>
        </>
      )}
    </div>
  );
}

function ListGroup({ group, label, items, current, href }: { group: ReviewGroup; label: string; items: { c: SampleCard; why: string }[]; current: string; href: (id: string) => string }) {
  const list = (
    <ul className="space-y-1">
      {items.map(({ c, why }) => (
        <li key={c.id}>
          <Link
            href={href(c.id)}
            scroll={false}
            aria-current={c.id === current ? "true" : undefined}
            className={`block min-h-11 rounded-lg px-3 py-2 ${c.id === current ? "bg-accent-tint ring-1 ring-accent/40" : "hover:bg-panel"}`}
            data-sample-item={group}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-semibold text-ink">{c.business}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${TONE[c.status] ?? "bg-bg text-ink"}`}>{CARD_LABEL[c.status] ?? c.status}</span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted">{why}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
  return group === "done" ? (
    <details className="mb-4" data-group={group}>
      <summary className="flex min-h-11 cursor-pointer items-center px-1 text-xs font-semibold tracking-wide text-muted uppercase">
        {label} · {items.length}
      </summary>
      {list}
    </details>
  ) : (
    <section className="mb-4" aria-label={label} data-group={group}>
      <h2 className="px-1 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
        {label} · {items.length}
      </h2>
      {list}
    </section>
  );
}
