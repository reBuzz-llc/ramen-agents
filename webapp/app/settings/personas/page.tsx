import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { BOTS_DIR, listBots } from "@/lib/bots";
import { readChanges, sideText, undoableNow, type CeoChange } from "@/lib/ceo-changes";
import { characterOf, personaView } from "@/lib/personas";
import { agentPids } from "@/lib/processes";
import CeoChangeUndo from "../../ceo-change-undo";
import { SettingsPage } from "../../settings-ui";
import { Badge, Panel } from "../../ui";
import SectionEdit from "./section-edit";

export const metadata = { title: "Personas · Settings" };
export const dynamic = "force-dynamic";

// Settings -> Personas (owner via creatorCC, queue 489: "where do I see the persona?"): pick a member (running first), read
// its persona.md by section, each marked as the owner's or as one the CEO may edit (common-data/persona-sections.toml),
// the CEO's persona changes of the last 7 days with Undo, and Edit on the owner's own sections.
/** A week ago, local time as the change records write it (outside render: the purity rule). */
function weekAgo(): string {
  const d = new Date(Date.now() - 7 * 86400_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}

export default async function PersonasPage(props: PageProps<"/settings/personas">) {
  const [bots, search, toml, changes] = await Promise.all([
    listBots().catch(() => []),
    props.searchParams,
    readFile(/*turbopackIgnore: true*/ path.join(BOTS_DIR, "common-data", "persona-sections.toml"), "utf8").catch(() => ""),
    readChanges().catch(() => [] as CeoChange[]),
  ]);
  const running = new Set<string>();
  await Promise.all(bots.map(async (b) => ((await agentPids(b.configPath).catch(() => [])).length ? running.add(b.slug) : null)));
  const withPersona = (
    await Promise.all(bots.map(async (b) => ({ b, text: await readFile(/*turbopackIgnore: true*/ path.join(BOTS_DIR, b.slug, "persona.md"), "utf8").catch(() => null) })))
  ).filter((x) => x.text !== null);
  const ordered = [...withPersona].sort((x, y) => Number(running.has(y.b.slug)) - Number(running.has(x.b.slug)) || x.b.name.localeCompare(y.b.name));
  const wanted = typeof search.bot === "string" ? search.bot : "";
  const pick = ordered.find((x) => x.b.slug === wanted) ?? ordered[0];
  if (!pick)
    return (
      <SettingsPage title="Personas" subtitle="Each member's persona, section by section">
        <p className="text-sm text-muted">No member has a persona.md yet.</p>
      </SettingsPage>
    );
  const character = characterOf(toml, pick.b.slug);
  const view = personaView(pick.text as string, character);
  const week = weekAgo();
  const mine = changes.filter((c) => c.bot === pick.b.slug && c.part === "persona" && c.applied_at >= week).sort((a, b) => b.applied_at.localeCompare(a.applied_at));
  const undoable = undoableNow(mine);
  return (
    <SettingsPage title="Personas" subtitle="Each member's persona, section by section: yours to edit, or the CEO's">
      <nav aria-label="Members" className="mb-4 flex flex-wrap gap-1.5">
        {ordered.map(({ b }) => (
          <Link
            key={b.slug}
            href={`/settings/personas?bot=${b.slug}`}
            aria-current={b.slug === pick.b.slug ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm ${b.slug === pick.b.slug ? "bg-sys-blue text-white" : "bg-fill-3 text-ink hover:bg-fill-2"} ${running.has(b.slug) ? "" : "opacity-70"}`}
          >
            {b.name}
            {running.has(b.slug) ? "" : " · stopped"}
          </Link>
        ))}
      </nav>
      {mine.length ? (
        <Panel title="The CEO's changes, last 7 days" className="mb-4">
          <ul className="divide-y divide-line text-sm">
            {mine.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 py-2">
                <p className="min-w-0 break-words text-ink">
                  <span className="mr-2 text-xs text-muted tabular-nums">{c.applied_at.replace("T", " ").slice(5, 16)}</span>
                  <span className="font-semibold">{c.section}</span>
                  {" · "}
                  {sideText(c, "after")}
                  {c.reason ? <span className="block text-xs text-muted">Why: {c.reason}</span> : null}
                  {c.status !== "applied" ? <span className="block text-xs font-semibold text-muted">{c.status === "undone" ? "Undone" : "Reverted by the Validator"}</span> : null}
                </p>
                {undoable.has(c.id) ? <CeoChangeUndo id={c.id} /> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <Panel title={pick.b.name} aside={`${view.sections.filter((s) => !s.owner).length} CEO may edit · ${view.sections.filter((s) => s.owner).length} yours`}>
        {view.preamble ? <p className="mb-3 text-sm whitespace-pre-wrap text-muted">{view.preamble.replace(/^#\s+/, "")}</p> : null}
        <div className="divide-y divide-line">
          {view.sections.map((s) => (
            <section key={s.heading} className="py-3" aria-label={s.heading}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-ink">{s.heading}</h3>
                <Badge tone={s.owner ? "info" : "warn"}>{s.owner ? "owner" : "CEO may edit"}</Badge>
              </div>
              <div className="mt-1.5 text-sm break-words whitespace-pre-wrap text-ink/85">{s.body.trim()}</div>
              {s.owner ? (
                <div className="mt-2">
                  <SectionEdit bot={pick.b.slug} section={s.heading} body={s.body} />
                </div>
              ) : (
                <p className="mt-1.5 text-xs text-muted">The CEO&apos;s: it may change this within its fence; undo a change above.</p>
              )}
            </section>
          ))}
        </div>
      </Panel>
    </SettingsPage>
  );
}
