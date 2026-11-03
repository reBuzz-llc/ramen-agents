import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import { DEFAULT_WEIGHTS, OUTCOMES } from "@/lib/leaderboard";
import { settingsTitle } from "@/lib/settings-nav";
import { btnOutline, btnPrimary, control, fieldLabel, helper, sectionTitle } from "@/lib/ui-classes";
import { PendingForm } from "../../ui";
import SectionHead from "../section-head";

export const metadata = { title: settingsTitle("rates") };

const OUTCOME_LABEL: Record<string, string> = { tasksDone: "Task done" };
const label = (k: string) => OUTCOME_LABEL[k] ?? k[0].toUpperCase() + k.slice(1);

export default async function Rates(props: PageProps<"/settings/rates">) {
  const who = await pageMe("/settings/rates");
  const msg = (await props.searchParams).msg;
  const s = who.settings;
  const owner = can(who.role, "settings.rates");
  return (
    <>
      <SectionHead slug="rates" msg={msg} />

      <section aria-labelledby="defaults">
        <h2 id="defaults" className={sectionTitle}>
          Default rates for new members
        </h2>
        <p className={helper}>
          A new member starts on these, and anyone without a rate of their own uses them; each person&apos;s own rate is set
          under People. A statement is hours × the hourly rate + the outcome bonus × (replies + meetings + clients). Nothing
          is computed until both are set; the hourly base must meet the minimum wage or contract terms where the person works.
        </p>
        <PendingForm action="/api/settings" method="post" className="mt-4 grid gap-4 sm:grid-cols-3">
          <input type="hidden" name="action" value="rates" />
          <label className={fieldLabel}>
            Hourly
            <input name="hourly" type="number" step="0.01" min={0} inputMode="decimal" defaultValue={s.rates?.hourly ?? ""} placeholder="Owner sets" disabled={!owner} className={control} />
          </label>
          <label className={fieldLabel}>
            Outcome bonus
            <input name="outcomeBonus" type="number" step="0.01" min={0} inputMode="decimal" defaultValue={s.rates?.outcomeBonus ?? ""} placeholder="Owner sets" disabled={!owner} className={control} />
          </label>
          <label className={fieldLabel}>
            Currency
            <input name="currency" defaultValue={s.rates?.currency ?? "USD"} maxLength={3} disabled={!owner} className={`${control} uppercase`} />
          </label>
          {owner ? (
            <div className="sm:col-span-3">
              <button className={btnPrimary}>Save rates</button>
            </div>
          ) : (
            <p className={`${helper} sm:col-span-3`}>The owner sets these.</p>
          )}
        </PendingForm>
      </section>

      <section aria-labelledby="points">
        <h2 id="points" className={sectionTitle}>
          Leaderboard points
        </h2>
        <p className={helper}>Points per outcome on the leaderboard; empty means the default shown. Hours never earn points.</p>
        <PendingForm action="/api/settings" method="post" className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <input type="hidden" name="action" value="points" />
          {OUTCOMES.map((k) => (
            <label key={k} className={fieldLabel}>
              {label(k)}
              <input name={k} type="number" min={0} inputMode="numeric" defaultValue={s.points?.[k] ?? ""} placeholder={String(DEFAULT_WEIGHTS[k])} disabled={!owner} className={control} />
            </label>
          ))}
          {owner ? (
            <div className="col-span-2 sm:col-span-3 lg:col-span-5">
              <button className={btnOutline}>Save points</button>
            </div>
          ) : null}
        </PendingForm>
      </section>
    </>
  );
}
