import { ownerDecisions, type Decision } from "@/lib/owner-decisions";
import { listBots } from "@/lib/bots";
import { PART_LABEL, readChanges, sideText, undoableNow, type CeoChange } from "@/lib/ceo-changes";
import { ownerItems, type OwnerItem } from "@/lib/owner-items";
import path from "node:path";
import { BOTS_DIR } from "@/lib/bots";
import { age, forgeBoard, readForge, type Wish } from "@/lib/forge";
import ForgeActions from "./forge-actions";
import { readRoster, rosterWords, statusWord, type RosterProposal, type Sheet } from "@/lib/roster-proposals";
import CeoChangeUndo from "./ceo-change-undo";
import DecisionActions from "./decision-actions";
import OwnerItemDone from "./owner-item-done";
import RosterProposalActions from "./roster-proposal-actions";

/** "Decisions waiting for you", from creatorCC's shared-state/owner-decisions.json: each open item with its date, its
 *  link, one button per option, Done, Later and a note (creatorCC queue 32). Answered items leave the list; "Show
 *  decided" lists the last 30 days. Hidden when nothing is open or decided. `compact` (the home board) folds it to its
 *  title line. Under a thin rule, the owner's open items from shared-state/owner-items.json (queue 401): title, "how"
 *  in small text, Done. Then "CEO changes" (queue 411): The CEO's own applied changes, newest first, each with Undo for
 *  its seven days; the newest five show, the rest fold under "Older". Persona changes (queue 440) show their section.
 *  First under the decisions, "Roster proposals" (queue 440): the CEO's start / stop / rename / create / retire, each with
 *  its reason, the goal it serves, the engine's resource sheet as a small table, Approve and Decline with a note (a create
 *  shows its persona draft, its name, goal and persona text editable); decided ones under "Decided in the last 7 days". */
export default async function OwnerDecisions({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const { open, decided } = await ownerDecisions().catch(() => ({ open: [] as Decision[], decided: [] as Decision[] }));
  const [items, changes, bots, roster] = await Promise.all([
    ownerItems().catch(() => [] as OwnerItem[]),
    readChanges().catch(() => [] as CeoChange[]),
    listBots().catch(() => []),
    readRoster().catch(() => ({ open: [] as RosterProposal[], decided: [] as RosterProposal[] })),
  ]);
  // the Forge (queue 478): members' wishes for a resource or a feature they lack
  const forge = forgeBoard(await readForge(path.join(BOTS_DIR, "common-data", "shared-state", "forge.jsonl")));
  const forgeAny = forge.open.length + forge.building.length + forge.later.length + forge.built.length + forge.declined.length > 0;
  if (!open.length && !decided.length && !items.length && !changes.length && !roster.open.length && !roster.decided.length && !forgeAny) return null;
  const undoable = undoableNow(changes);
  const name = (slug: string) => bots.find((b) => b.slug === slug)?.name ?? slug;
  const change = (c: CeoChange) => (
    <li key={c.id} className="flex items-start justify-between gap-3">
      <p className="min-w-0 break-words text-ink">
        <span className="mr-2 text-xs text-muted tabular-nums">{c.applied_at.replace("T", " ").slice(5, 16)}</span>
        <span className="font-semibold">{name(c.bot)}</span>
        {" · "}
        {c.part === "persona" ? `persona · ${c.section}` : c.part ? PART_LABEL[c.part] : c.field || c.kind}
        {" · "}
        <span className="text-muted">{sideText(c, "before")}</span>
        {" → "}
        {sideText(c, "after")}
        {c.reason ? <span className="text-xs text-muted"> · {c.reason}</span> : null}
        {c.status === "undone" ? <span className="ml-1 text-xs font-semibold text-muted">· Undone{c.undone_by ? ` by ${c.undone_by}` : ""}</span> : null}
        {c.status === "reverted" ? <span className="ml-1 text-xs font-semibold text-bad">· Reverted by the Validator{c.validator_note ? `: ${c.validator_note}` : ""}</span> : null}
      </p>
      {undoable.has(c.id) ? <CeoChangeUndo id={c.id} /> : null}
    </li>
  );
  const title = `Decisions waiting for you (${open.length + roster.open.length + forge.open.length})${items.length ? ` · ${items.length} for you to do` : ""}`;
  const rosterCard = (p: RosterProposal) => (
    <li key={p.id} className="py-2">
      <p className="text-ink">
        <span className="font-semibold">{rosterWords(p, name(p.bot))}</span>
        <span className="ml-2 text-xs text-muted tabular-nums">{p.ts.replace("T", " ").slice(5, 16)}</span>
      </p>
      {p.sheet.line ? <p className="mt-0.5 text-sm text-ink">{p.sheet.line}</p> : null}
      <SheetTable sheet={p.sheet} member={p.create?.name || name(p.bot)} />
      {p.reason ? <p className="mt-1 text-xs text-muted break-words">Why: {p.reason}</p> : null}
      {p.goalServed ? <p className="text-xs text-muted break-words">Serves: {p.goalServed}</p> : null}
      {p.create ? (
        <div className="mt-1 text-xs text-muted">
          <p className="break-words">
            Role: {p.create.role || "–"}
            {p.create.template ? ` · template ${p.create.template}` : ""}
            {p.create.expectedCalls !== null ? ` · about ${p.create.expectedCalls} calls a day` : ""}
          </p>
          {p.create.rules.length ? <p className="break-words">Rules: {p.create.rules.join(" · ")}</p> : null}
        </div>
      ) : null}
      <RosterProposalActions id={p.id} action={p.action} draft={p.create ? { name: p.create.name, goal: p.create.goal, persona: p.create.persona } : null} />
    </li>
  );
  const body = (
    <>
      {open.length ? (
        <ul className="mt-1 space-y-3 text-sm">
          {open.map((d) => (
            <li key={d.id} className="text-ink">
              <p>
                {d.since ? <span className="mr-2 text-xs text-muted tabular-nums">{d.since.slice(5, 10)}</span> : null}
                {d.text}
                {d.link ? (
                  <a href={d.link.href} className="ml-2 text-xs font-semibold text-accent underline-offset-2 hover:underline">
                    {d.link.label}
                  </a>
                ) : null}
              </p>
              <DecisionActions id={d.id} options={d.options} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted">Nothing waiting.</p>
      )}
      {roster.open.length || roster.decided.length ? (
        <div className="mt-3 border-t border-line pt-2" aria-label="Roster proposals">
          <p className="text-xs font-semibold text-muted">Roster proposals ({roster.open.length} open)</p>
          {roster.open.length ? <ul className="divide-y divide-line text-sm">{roster.open.map(rosterCard)}</ul> : null}
          {roster.decided.length ? (
            <details className="mt-1 text-sm">
              <summary className="cursor-pointer text-xs text-muted">Decided in the last 7 days ({roster.decided.length})</summary>
              <ul className="mt-1 divide-y divide-line">
                {roster.decided.map((p) => (
                  <li key={p.id} className="py-1.5 break-words">
                    <span className={`mr-2 text-xs font-semibold ${p.status === "applied" ? "text-good" : p.status === "failed" ? "text-bad" : "text-muted"}`}>
                      {statusWord(p)} {p.decidedAt.replace("T", " ").slice(5, 16)}
                    </span>
                    <span className="text-ink">{rosterWords(p, name(p.bot))}</span>
                    {p.ownerNote ? <span className="text-muted"> · “{p.ownerNote}”</span> : null}
                    {p.expiredNote ? <span className="text-muted"> · {p.expiredNote}</span> : null}
                    {p.applyResult ? <span className="text-xs text-muted"> · {p.applyResult}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      {forgeAny ? (
        <div className="mt-3 border-t border-line pt-2" aria-label="The Forge">
          <p className="text-xs font-semibold text-muted">
            The Forge: what the members wish for ({forge.open.length} open{forge.building.length ? `, ${forge.building.length} building` : ""})
          </p>
          {forge.open.length ? (
            <ul className="divide-y divide-line text-sm">
              {forge.open.map((w: Wish) => (
                <li key={w.id} className="py-2">
                  <p className="break-words text-ink">
                    <span className="font-semibold">{name(w.bot)}</span>
                    {w.for !== w.bot ? <span className="text-muted"> for {name(w.for)}</span> : null}
                    {": "}
                    {w.what}
                    <span className="ml-2 text-xs text-muted tabular-nums">{age(w.ts)} ago</span>
                  </p>
                  {w.why ? <p className="mt-0.5 text-xs break-words text-muted">Why: {w.why}</p> : null}
                  {w.keyResult ? <p className="text-xs break-words text-muted">Serves: {w.keyResult}</p> : null}
                  {w.note ? <p className="text-xs break-words text-muted">Earlier: {w.note}</p> : null}
                  <ForgeActions id={w.id} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No wish waiting.</p>
          )}
          {forge.building.length || forge.later.length || forge.built.length || forge.declined.length ? (
            <details className="mt-1 text-sm">
              <summary className="cursor-pointer text-xs text-muted">
                Building {forge.building.length} · later {forge.later.length} · built {forge.built.length} · declined {forge.declined.length} (30 days)
              </summary>
              <ul className="mt-1 divide-y divide-line">
                {([["Building", forge.building], ["Later", forge.later], ["Built", forge.built], ["No", forge.declined]] as const).flatMap(([label, list]) =>
                  list.map((w) => (
                    <li key={w.id} className="py-1.5 break-words">
                      <span className={`mr-2 text-xs font-semibold ${label === "Built" ? "text-good" : "text-muted"}`}>
                        {label} {w.decidedAt.replace("T", " ").slice(5, 16)}
                      </span>
                      <span className="text-ink">
                        {name(w.for)}: {w.what}
                      </span>
                      {w.note ? <span className="text-muted"> · “{w.note}”</span> : null}
                    </li>
                  )),
                )}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      {items.length ? (
        <ul className="mt-3 space-y-2 border-t border-line pt-2 text-sm" aria-label="Your open items">
          {items.map((it) => (
            <li key={it.id} className="flex items-start justify-between gap-3 text-ink">
              <div className="min-w-0">
                <p>{it.title}</p>
                {it.how ? <p className="text-xs text-muted break-words">{it.how}</p> : null}
              </div>
              <OwnerItemDone id={it.id} revert={!!it.persona} />
            </li>
          ))}
        </ul>
      ) : null}
      {changes.length ? (
        <div className="mt-3 border-t border-line pt-2">
          <p className="text-xs font-semibold text-muted">CEO changes ({undoable.size} can be undone)</p>
          <ul className="mt-1 space-y-2 text-sm">{changes.slice(0, 5).map(change)}</ul>
          {changes.length > 5 ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted">Older ({changes.length - 5})</summary>
              <ul className="mt-1 space-y-2 text-sm">{changes.slice(5).map(change)}</ul>
            </details>
          ) : null}
        </div>
      ) : null}
      {decided.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-accent">Show decided ({decided.length})</summary>
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {decided.map((d) => (
              <li key={d.id}>
                <span className="mr-2 tabular-nums">{d.decided_at.slice(5, 10)}</span>
                <span className="text-ink">{d.status === "done" ? "Done" : d.choice}</span>
                {" · "}
                {d.text}
                {d.note ? <span className="italic"> · “{d.note}”</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="mt-2 border-t border-line pt-1.5 text-right text-xs">
        <a href="/settings/glossary" className="text-muted underline-offset-2 hover:text-accent hover:underline">
          Glossary
        </a>
      </p>
    </>
  );
  return (
    <div className={className}>
      {compact ? (
        <details id="decisions" className="scroll-mt-24 rounded-lg border border-line bg-panel px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold text-ink">{title}</summary>
          {body}
        </details>
      ) : (
        <section className="rounded-lg border border-line bg-panel px-3 py-2">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {body}
        </section>
      )}
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** The engine's resource sheet as a small table: the member's use yesterday, the family's allowance share, after the
 *  change, the Mac's memory. A value the sheet does not have is a dash. */
function SheetTable({ sheet, member }: { sheet: Sheet; member: string }) {
  const use =
    sheet.tokensYesterday !== null
      ? `${fmt(sheet.tokensYesterday)} tokens${sheet.callsYesterday !== null ? ` · ${fmt(sheet.callsYesterday)} calls` : ""}${sheet.estimate ? " (estimate)" : ""}`
      : sheet.callsYesterday !== null
        ? `${fmt(sheet.callsYesterday)} calls${sheet.estimate ? " (estimate)" : ""}`
        : "–";
  const rows: [string, string][] = [
    [`${member}, yesterday`, use],
    ["Family's free allowance, yesterday", sheet.familyPct !== null ? `${Math.round(sheet.familyPct)}%` : "–"],
    ["With this change", sheet.afterPct !== null ? `about ${Math.round(sheet.afterPct)}%` : "–"],
    ["Mac memory", sheet.freeGb !== null ? `${sheet.freeGb.toFixed(1)} GB free${sheet.swapGb !== null ? ` · swap ${sheet.swapGb.toFixed(1)} GB` : ""}` : "–"],
  ];
  return (
    // a four-line key/value sheet, not a list: nothing to sort (the one table left plain; tests/tables.test.ts)
    <table data-nosort className="mt-1 w-full max-w-md text-xs">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-t border-line first:border-t-0">
            <th scope="row" className="py-0.5 pr-3 text-left font-normal text-muted">
              {k}
            </th>
            <td className="py-0.5 text-right whitespace-nowrap text-ink tabular-nums">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
