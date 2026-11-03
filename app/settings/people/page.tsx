import { eq } from "drizzle-orm";
import { pageMe } from "@/lib/page-me";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { can } from "@/lib/roles";
import { canRemove } from "@/lib/team";
import { rateHistories } from "@/lib/member-rates";
import { canSeePay, canSetRate, dayOf, rateOn, type RateRow } from "@/lib/rates";
import { settingsTitle } from "@/lib/settings-nav";
import { btnOutline, btnText, control, fieldLabel } from "@/lib/ui-classes";
import { PendingForm } from "../../ui";
import AddMember, { CopySignIn, RemoveMember } from "../add-member";
import SectionHead from "../section-head";

export const metadata = { title: settingsTitle("people") };

const badge = "rounded-full px-2.5 py-0.5 text-xs";

export default async function People(props: PageProps<"/settings/people">) {
  const who = await pageMe("/settings/people");
  const msg = (await props.searchParams).msg;
  const d = await db();
  const s = who.settings;
  const [people, histories] = await Promise.all([
    d.select().from(users).where(eq(users.tenantId, who.tenantId)),
    // Pay rates: read only for those who may set them (owner, managers).
    can(who.role, "rates.members") ? rateHistories(d, who.tenantId) : Promise.resolve(new Map<string, RateRow[]>()),
  ]);
  // Pay is for the person, their manager and the owner: a member's Settings shows nobody's rate.
  const today = dayOf(new Date());
  const me = { id: who.userId, role: who.role };
  const fmt = (n: number | undefined, c?: string) => (typeof n === "number" ? `${c || "USD"} ${n.toFixed(2)}` : "not set");
  return (
    <>
      <SectionHead slug="people" msg={msg} />
      <ul aria-label="The team" className="divide-y divide-line rounded-2xl bg-panel">
        {people.map((p) => {
          const rows = histories.get(p.id) ?? [];
          const r = rateOn(rows, s.rates ?? {}, today);
          const invited = p.active && !p.firstSignedInAt && p.role !== "owner";
          return (
            <li key={p.id} className={`space-y-2 p-4 ${p.active ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-semibold">
                    {p.name || p.email}
                    {!p.active ? <span className={`${badge} bg-bg font-normal text-muted`}>Removed (add them again to restore)</span> : invited ? <span className={`${badge} bg-accent-tint font-normal`}>Invited, not signed in yet</span> : null}
                  </p>
                  {p.name ? <p className="truncate text-sm text-muted">{p.email}</p> : null}
                </div>
                {can(who.role, "users.manage") && p.role !== "owner" ? (
                  <PendingForm action="/api/settings" method="post" className="flex items-end gap-2">
                    <input type="hidden" name="action" value="role" />
                    <input type="hidden" name="userId" value={p.id} />
                    <label className="sr-only" htmlFor={`role-${p.id}`}>
                      Role of {p.name || p.email}
                    </label>
                    <select id={`role-${p.id}`} name="role" defaultValue={p.role} className={`${control} w-36`}>
                      <option value="member">Member</option>
                      <option value="manager">Manager</option>
                    </select>
                    <button className={btnOutline}>Change</button>
                  </PendingForm>
                ) : (
                  <span className={`${badge} bg-bg text-muted capitalize`}>{p.role}</span>
                )}
              </div>
              {(invited && can(who.role, "users.add")) || (p.active && can(who.role, "users.add") && canRemove(me, p)) ? (
                <div className="flex flex-wrap items-center gap-x-4">
                  {invited && can(who.role, "users.add") ? <CopySignIn email={p.email} name={p.name} ownerName={who.name} /> : null}
                  {p.active && can(who.role, "users.add") && canRemove(me, p) ? <RemoveMember userId={p.id} email={p.email} /> : null}
                </div>
              ) : null}
              {canSeePay(me, p) && can(who.role, "rates.members") ? (
                <p className="text-sm text-muted">
                  {fmt(r.hourly, r.currency)}/h · bonus {fmt(r.outcomeBonus, r.currency)} {r.from ? `since ${r.from}` : "(company defaults)"}
                  {rows.length > 1 ? ` · earlier: ${rows.slice(0, -1).reverse().slice(0, 3).map((x) => `${x.effectiveFrom} ${x.hourly ?? "-"}`).join(", ")}` : ""}
                </p>
              ) : null}
              {canSetRate(me, p) && can(who.role, "rates.members") ? (
                <details className="group">
                  <summary className={`${btnText} cursor-pointer list-none`}>Set a new rate</summary>
                  <PendingForm action="/api/settings" method="post" className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] sm:items-end">
                    <input type="hidden" name="action" value="memberRate" />
                    <input type="hidden" name="userId" value={p.id} />
                    <label className={fieldLabel}>
                      Hourly
                      <input name="hourly" type="number" step="0.01" min={0} inputMode="decimal" className={control} />
                    </label>
                    <label className={fieldLabel}>
                      Bonus
                      <input name="outcomeBonus" type="number" step="0.01" min={0} inputMode="decimal" className={control} />
                    </label>
                    <label className={fieldLabel}>
                      Currency
                      <input name="currency" defaultValue={r.currency ?? "USD"} maxLength={3} className={`${control} uppercase`} />
                    </label>
                    <label className={fieldLabel}>
                      From
                      <input name="effectiveFrom" type="date" defaultValue={today} className={control} />
                    </label>
                    <button className={`${btnOutline} col-span-2 justify-self-start sm:col-span-1`}>Set rate</button>
                  </PendingForm>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
      {can(who.role, "users.add") ? <AddMember canAddManager={who.role === "owner"} ownerName={who.name} /> : null}
    </>
  );
}
