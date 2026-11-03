import Link from "next/link";
import { cadenceFor, CADENCES, entryAt } from "@/lib/cadence";
import { db } from "@/lib/db";
import type { Me } from "@/lib/principal";
import { projectsOf, type Project } from "@/lib/projects";
import { can } from "@/lib/roles";
import { btnOutline, btnText, control, labelText } from "@/lib/ui-classes";
import { PendingForm } from "../ui";

// The Projects panel, beside the clock on wide screens and under it on a phone. One list: each project a row (name, client, its update cadence);
// tapping a row opens its editor in place: name and cadence in one form with one Save, then Archive, and "Merge into
// another project" tucked behind its own disclosure because it moves hours. Archived projects sit in their own folded
// group. New projects are added at the top. Forms post to Settings' endpoint and come back here.
const back = <input type="hidden" name="return" value="/" />;

function Chevron() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-muted transition-transform group-open:rotate-90">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export default async function ManageProjects({ who, msg }: { who: Me; msg?: string }) {
  const list = await projectsOf(await db(), who.tenantId);
  const now = new Date();
  const s = who.settings;
  const manage = can(who.role, "projects.manage");
  const label = (m: number) => CADENCES.find((c) => c.minutes === m)?.label ?? `every ${m} minutes`;
  const companyCadence = label(cadenceFor(null, s)(now)).toLowerCase();
  const own = (p: Project) => {
    const e = entryAt(p.cadenceHistory, now);
    return e && e.minutes !== null ? String(e.minutes) : "default";
  };
  const cadenceOf = (p: Project) => (own(p) === "default" ? companyCadence : label(cadenceFor(p, s)(now)).toLowerCase());
  // "update reminders every hour", or "no update reminders"
  const reminders = (c: string) => (c.startsWith("no ") ? "no update reminders" : `update reminders ${c}`);
  const open = list.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name));
  const archived = list.filter((p) => !p.active).sort((a, b) => a.name.localeCompare(b.name));

  const row = (p: Project) => (
    <li key={p.id}>
      <details className="group">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-xl px-3 py-2 hover:bg-bg [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            <span className={`block truncate font-medium ${p.active ? "" : "text-muted"}`}>{p.name}</span>
            <span className="block truncate text-xs text-muted">
              {p.client ? `${p.client} · ` : ""}{reminders(cadenceOf(p))}
            </span>
          </span>
          {manage ? <Chevron /> : null}
        </summary>
        {manage ? (
          <div className="mx-3 mb-3 space-y-3 rounded-xl border border-line bg-bg p-3">
            <PendingForm action="/api/settings" method="post" className="space-y-3">
              <input type="hidden" name="action" value="editProject" />
              <input type="hidden" name="projectId" value={p.id} />
              {back}
              <label className="block">
                <span className={labelText}>Name</span>
                <input name="name" defaultValue={p.name} maxLength={80} required className={`mt-1 ${control}`} />
              </label>
              <label className="block">
                <span className={labelText}>Update reminders</span>
                <select name="cadence" defaultValue={own(p)} className={`mt-1 ${control}`}>
                  <option value="default">Company default ({companyCadence})</option>
                  {CADENCES.map((c) => (
                    <option key={c.minutes} value={c.minutes}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center justify-between gap-3">
                <button className={btnOutline}>Save</button>
                <Link href={`/projects/${p.id}`} className={btnText}>
                  Work log
                </Link>
              </div>
            </PendingForm>
            <div className="space-y-1 border-t border-line pt-2">
              <PendingForm action="/api/settings" method="post">
                <input type="hidden" name="action" value="projectActive" />
                <input type="hidden" name="projectId" value={p.id} />
                <input type="hidden" name="active" value={p.active ? "0" : "1"} />
                {back}
                <button className={btnText}>{p.active ? "Archive (keeps its hours)" : "Restore to the picker"}</button>
              </PendingForm>
              {p.active ? (
                <details>
                  <summary className="min-h-11 cursor-pointer py-2 text-sm text-muted hover:text-ink">Merge into another project…</summary>
                  <PendingForm action="/api/settings" method="post" className="mt-1 flex gap-2">
                    <input type="hidden" name="action" value="mergeProject" />
                    <input type="hidden" name="projectId" value={p.id} />
                    {back}
                    <select name="into" required defaultValue="" aria-label={`Merge ${p.name} into`} className={control}>
                      <option value="" disabled>
                        Move its hours to…
                      </option>
                      <option value="general">General</option>
                      {open
                        .filter((x) => x.id !== p.id)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                    </select>
                    <button className={btnOutline}>Merge</button>
                  </PendingForm>
                  <p className="mt-1 text-xs text-muted">For duplicates: its hours move over and this project goes.</p>
                </details>
              ) : null}
            </div>
          </div>
        ) : null}
      </details>
    </li>
  );

  return (
    <section id="projects" aria-labelledby="projects-title" className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 id="projects-title" className="text-lg font-semibold">
          Projects
        </h2>
        <span className="text-sm text-muted">{open.length} open</span>
      </div>
      <p className="mt-1 px-1 text-sm text-muted">What people clock in to. {manage ? "Tap one to rename it, set how often it asks for an update, or archive it." : ""}</p>
      {msg ? (
        <p role="status" className="mt-3 rounded-xl bg-good/10 px-3 py-2 text-sm text-good">
          {msg}
        </p>
      ) : null}
      {manage ? (
        <PendingForm action="/api/settings" method="post" className="mt-3 space-y-2 px-1">
          <input type="hidden" name="action" value="addProject" />
          {back}
          <div className="flex gap-2">
            <input name="name" required maxLength={80} placeholder="New project" aria-label="New project's name" className={control} />
            <button className={btnOutline}>Add</button>
          </div>
          <input name="client" maxLength={80} placeholder="Client (optional)" aria-label="Client" className={control} />
        </PendingForm>
      ) : null}
      <ul className="mt-3 divide-y divide-line">
        <li className="flex min-h-12 items-center gap-3 px-3 py-2">
          <span className="min-w-0 flex-1">
            <Link href="/projects/general" className="block font-medium hover:text-accent-ink">
              General
            </Link>
            <span className="block text-xs text-muted">built in · {reminders(companyCadence)}</span>
          </span>
        </li>
        {open.map(row)}
      </ul>
      {!open.length ? <p className="px-3 py-2 text-sm text-muted">No projects yet: add one above, or pick &quot;+ New project…&quot; when you clock in.</p> : null}
      {archived.length ? (
        <details className="mt-2 border-t border-line pt-2">
          <summary className="min-h-11 cursor-pointer px-3 py-2 text-sm text-muted hover:text-ink">Archived ({archived.length})</summary>
          <ul className="divide-y divide-line">{archived.map(row)}</ul>
        </details>
      ) : null}
      {!manage ? <p className="mt-3 px-1 text-xs text-muted">The owner and managers edit projects; you can create one from the clock&apos;s picker.</p> : null}
    </section>
  );
}
