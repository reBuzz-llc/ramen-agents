import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import { cadenceFor, CADENCES, ROUNDINGS } from "@/lib/cadence";
import { settingsTitle } from "@/lib/settings-nav";
import { btnOutline, btnPrimary, control, fieldLabel, helper, sectionTitle } from "@/lib/ui-classes";
import { PendingForm } from "../../ui";
import SectionHead from "../section-head";
import { DEFAULT_EMAIL_GOAL, DEFAULT_WHATSAPP_GOAL, goalsOf } from "@/lib/send-goals";

export const metadata = { title: settingsTitle("company") };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function Company(props: PageProps<"/settings/company">) {
  const who = await pageMe("/settings/company");
  const msg = (await props.searchParams).msg;
  const s = who.settings;
  const manage = can(who.role, "projects.manage");
  const krs = can(who.role, "settings.keyResults");
  const owner = can(who.role, "settings.rates");
  const goals = goalsOf(s);
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
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

      <section aria-labelledby="send-goals">
        <h2 id="send-goals" className={sectionTitle}>
          Daily send goals
        </h2>
        <p className={helper}>
          How many first emails and WhatsApp messages each person sends a day. Many sends from one address in a day land in
          spam more often, so the pack fills only up to what is left today and Mark sent past the goal is refused. Checking
          numbers is not a send and has no limit. The day starts at midnight in the company&apos;s time zone.
        </p>
        <PendingForm action="/api/settings" method="post" className="mt-4 grid gap-4 sm:grid-cols-3">
          <input type="hidden" name="action" value="sendGoals" />
          <label className={fieldLabel}>
            Emails a day, per person
            <input name="daily_email_goal" type="number" min={0} max={200} inputMode="numeric" defaultValue={goals.email} placeholder={String(DEFAULT_EMAIL_GOAL)} disabled={!owner} className={control} />
          </label>
          <label className={fieldLabel}>
            WhatsApp messages a day, per person
            <input name="daily_whatsapp_goal" type="number" min={0} max={200} inputMode="numeric" defaultValue={goals.whatsapp} placeholder={String(DEFAULT_WHATSAPP_GOAL)} disabled={!owner} className={control} />
          </label>
          <label className={fieldLabel}>
            Time zone
            <input name="timezone" list="time-zones" defaultValue={s.timezone ?? ""} placeholder="The server's clock (UTC)" disabled={!owner} className={control} />
            <datalist id="time-zones">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </label>
          {owner ? (
            <div className="sm:col-span-3">
              <button className={btnOutline}>Save send goals</button>
            </div>
          ) : (
            <p className={`${helper} sm:col-span-3`}>The owner changes these.</p>
          )}
        </PendingForm>
      </section>

      <section aria-labelledby="world">
        <h2 id="world" className={sectionTitle}>
          Live world
        </h2>
        <p className={helper}>
          The office, read-only, at the top of the Family page. It runs on the machine that runs the agents; paste the
          address your tunnel printed (see the fleet&apos;s webapp/docs/world-public.md). Empty: no office on the Family page.
        </p>
        <PendingForm action="/api/settings" method="post" className="mt-4 grid gap-4 sm:grid-cols-3">
          <input type="hidden" name="action" value="worldUrl" />
          <label className={`${fieldLabel} sm:col-span-2`}>
            Live world address
            <input name="world_url" type="url" inputMode="url" defaultValue={s.worldUrl ?? ""} placeholder="https://…" disabled={!owner} className={control} />
          </label>
          {owner ? (
            <div className="sm:col-span-3">
              <button className={btnOutline}>Save address</button>
              {s.worldUrl && !process.env.WORLD_SHARE_SECRET ? <p className={`${helper} mt-2`}>The link secret (WORLD_SHARE_SECRET) is not set on this server yet: the frame stays hidden until it is.</p> : null}
            </div>
          ) : null}
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
