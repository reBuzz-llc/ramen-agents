import { eq } from "drizzle-orm";
import { pageMe } from "@/lib/page-me";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { can } from "@/lib/roles";
import { canRemove } from "@/lib/team";
import { approvedWeeks, rateHistories } from "@/lib/member-rates";
import { canSeePay, canSetRate, dayOf, rateLocks, rateOn, type RateRow } from "@/lib/rates";
import { settingsTitle } from "@/lib/settings-nav";
import AddMember from "../add-member";
import PeopleList, { type Person } from "./people-list";
import SectionHead from "../section-head";
import { displayName } from "@/lib/display-name";
import { offBoardIds } from "@/lib/team-board";

export const metadata = { title: settingsTitle("people") };

export default async function People(props: PageProps<"/settings/people">) {
  const who = await pageMe("/settings/people");
  const msg = (await props.searchParams).msg;
  const d = await db();
  const s = who.settings;
  const [people, histories, weeks] = await Promise.all([
    d.select().from(users).where(eq(users.tenantId, who.tenantId)),
    // Pay rates: read only for those who may set them (owner, managers).
    can(who.role, "rates.members") ? rateHistories(d, who.tenantId) : Promise.resolve(new Map<string, RateRow[]>()),
    can(who.role, "rates.members") ? approvedWeeks(d, who.tenantId) : Promise.resolve(new Map<string, string[]>()),
  ]);
  // Pay is for the person, their manager and the owner: a member's Settings shows nobody's rate.
  const today = dayOf(new Date());
  const me = { id: who.userId, role: who.role };
  // each person as the list shows them: what this viewer may change, and the rate only for those who may see it
  const off = offBoardIds(people, s);
  const list: Person[] = people.map((p) => {
    const rows = histories.get(p.id) ?? [];
    const r = rateOn(rows, s.rates ?? {}, today);
    const invited = p.active && !p.firstSignedInAt && p.role !== "owner";
    const seePay = canSeePay(me, p) && can(who.role, "rates.members");
    const locks = rateLocks(rows, weeks.get(p.id) ?? []);
    return {
      id: p.id,
      label: displayName(p.name, p.email),
      name: p.name ?? "",
      email: p.email,
      role: p.role,
      active: p.active,
      invited,
      nameMissing: !(p.name ?? "").trim(),
      isMe: p.id === who.userId,
      may: {
        name: p.id === who.userId || can(who.role, "users.add"),
        role: can(who.role, "users.manage") && p.role !== "owner",
        rate: canSetRate(me, p) && can(who.role, "rates.members"),
        seePay,
        remove: p.active && can(who.role, "users.add") && canRemove(me, p),
        copySignIn: invited && can(who.role, "users.add"),
        // the owner's switch for anyone but an owner account (always off the board)
        offBoard: who.role === "owner" && p.role !== "owner" && p.active,
      },
      offBoard: off.has(p.id),
      rate: seePay ? { hourly: r.hourly, outcomeBonus: r.outcomeBonus, currency: r.currency, from: r.from } : null,
      history: seePay ? rows.map((h) => ({ from: h.effectiveFrom, hourly: h.hourly, outcomeBonus: h.outcomeBonus, currency: h.currency, locked: locks.has(h.effectiveFrom) })) : [],
    };
  });
  return (
    <>
      <SectionHead slug="people" msg={msg} />
      <PeopleList people={list} today={today} ownerName={who.name} />
      {can(who.role, "users.add") ? <AddMember canAddManager={who.role === "owner"} ownerName={who.name} /> : null}
    </>
  );
}
