import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import { cadenceFor, CADENCES, ROUNDINGS } from "@/lib/cadence";
import { settingsTitle } from "@/lib/settings-nav";
import { btnOutline, btnPrimary, control, fieldLabel, helper, sectionTitle } from "@/lib/ui-classes";
import { PendingForm } from "../../ui";
import SectionHead from "../section-head";

export const metadata = { title: settingsTitle("company") };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function Company(props: PageProps<"/settings/company">) {
  const who = await pageMe("/settings/company");
  const msg = (await props.searchParams).msg;
  const s = who.settings;
  const manage = can(who.role, "projects.manage");
  const krs = can(who.role, "settings.keyResults");
  return (
    <>
      <SectionHead slug="company" msg={msg} />
      <p className="text-[0.9375rem]">
        <span className="text-muted">Company: </span>
        <span className="font-semibold">{who.tenantName}</span>
      </p>

      <section aria-labelledby="updates">
        <h2 id="updates" className={sectionTitle}>
          Time &amp; updates
        </h2>
        <p className={helper}>
          The cadence asks people on a project for a &quot;Now doing…&quot; note once per window: a reminder and a record for the
          client, never a deduction. Rounding applies to paid and total hours only; the clock keeps exact times.
        </p>
        <PendingForm action="/api/settings" method="post" className="mt-4 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="action" value="updates" />
          <label className={fieldLabel}>
            Default cadence
            <select name="cadence" defaultValue={String(cadenceFor(null, s)(new Date()))} disabled={!manage} className={control}>
              {CADENCES.map((c) => (
                <option key={c.minutes} value={c.minutes}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldLabel}>
            Round shift times
            <select name="rounding" defaultValue={String(s.updates?.rounding ?? 0)} disabled={!manage} className={control}>
              {ROUNDINGS.map((r) => (
                <option key={r} value={r}>
                  {r ? `To ${r} minutes` : "No rounding"}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldLabel}>
            Week starts on
            <select name="weekStartDay" defaultValue={String(s.updates?.weekStartDay ?? 1)} disabled={!manage} className={control}>
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldLabel}>
            Idle time
            <select name="idle" defaultValue="off" disabled className={control}>
              <option value="off">Off (comes with the desktop tracker)</option>
            </select>
          </label>
          {manage ? (
            <div className="sm:col-span-2">
              <button className={btnPrimary}>Save</button>
            </div>
          ) : (
            <p className={`${helper} sm:col-span-2`}>An owner or manager changes these.</p>
          )}
        </PendingForm>
      </section>

      <section aria-labelledby="krs">
        <h2 id="krs" className={sectionTitle}>
          This week&apos;s key results
        </h2>
        <p className={helper}>The targets the home page and This week measure the team against.</p>
        <PendingForm action="/api/settings" method="post" className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <input type="hidden" name="action" value="keyResults" />
          {(
            [
              ["sent", "Emails sent"],
              ["replies", "Replies"],
              ["meetings", "Meetings"],
              ["tasksDone", "Tasks done"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className={fieldLabel}>
              {label}
              <input name={k} type="number" min={0} inputMode="numeric" defaultValue={s.keyResults?.[k] ?? ""} disabled={!krs} className={control} />
            </label>
          ))}
          {krs ? (
            <div className="col-span-2 sm:col-span-4">
              <button className={btnOutline}>Save key results</button>
            </div>
          ) : null}
        </PendingForm>
      </section>
    </>
  );
}
