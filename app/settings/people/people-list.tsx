"use client";
// Settings → People: each person is a row; one Edit opens that person's details in the row
// -- name, role, rate, remove -- with one Save and a Cancel, one row open at a time. Save writes only what
// changed (the rate only when its fields were touched and differ: lib/rates.ts rateToWrite). What cannot be edited says
// so and says what to do instead. Removing someone or a rate asks once, in a row of its own (no browser confirm).
import { useRouter } from "next/navigation";
import { useState } from "react";
import PixelLoader from "@/app/pixel-loader";
import { btnDanger, btnOutline, btnPrimary, btnText, control, fieldLabel } from "@/lib/ui-classes";
import { CopySignIn } from "../add-member";

export type PersonRate = { hourly?: number; outcomeBonus?: number; currency?: string; from: string | null };
export type PersonHistory = { from: string; hourly: number | null; outcomeBonus: number | null; currency: string; locked: boolean };
export type Person = {
  id: string;
  label: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  invited: boolean;
  nameMissing: boolean;
  isMe: boolean;
  may: { name: boolean; role: boolean; rate: boolean; seePay: boolean; remove: boolean; copySignIn: boolean; offBoard?: boolean };
  /** left off This week's lists and the leaderboard (an owner account always; another person by the owner's switch) */
  offBoard?: boolean;
  rate: PersonRate | null; // null: pay not shown to this viewer
  history: PersonHistory[];
};

const money = (n: number | null | undefined, c?: string) => (typeof n === "number" ? `${c || "USD"} ${n.toFixed(2)}` : "not set");
const badge = "rounded-full px-2.5 py-0.5 text-xs";

function RateLine({ r }: { r: PersonRate }) {
  return r.from ? (
    <p className="text-sm">
      <span className="font-semibold">{money(r.hourly, r.currency)}/h</span> · bonus {money(r.outcomeBonus, r.currency)} · since {r.from}
    </p>
  ) : (
    <p className="text-sm text-muted">{typeof r.hourly === "number" ? `The company's default rate (${money(r.hourly, r.currency)}/h)` : "No rate set yet (the company has no default)"}</p>
  );
}

/** Ask once before acting: the question in words that say what happens, the action and Keep. */
function Confirm({ text, act, onKeep, children }: { text: string; act: string; onKeep: () => void; children: (busy: boolean) => React.ReactNode }) {
  return (
    // the sentence over its buttons on a phone, beside them from 640 px
    <div role="group" aria-label={act} className="flex flex-col gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-sm sm:flex-row sm:items-center">
      <span className="min-w-0 sm:flex-1">{text}</span>
      <span className="flex flex-wrap items-center gap-2">
        {children(false)}
        <button type="button" onClick={onKeep} className={btnOutline}>
          Keep
        </button>
      </span>
    </div>
  );
}

function RemoveFromTeam({ userId, first }: { userId: string; first: string }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const remove = async () => {
    setBusy(true);
    setError("");
    const r = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", userId }) })
      .then((x) => x.json() as Promise<{ ok: boolean; error?: string }>)
      .catch(() => ({ ok: false, error: "No answer from the server." }));
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Could not remove them.");
    router.refresh();
  };
  return ask ? (
    <Confirm text={`${first} can no longer sign in; their hours and outcomes stay. Add them again to restore.`} act="Remove from team" onKeep={() => setAsk(false)}>
      {() => (
        <>
          <button type="button" disabled={busy} onClick={() => void remove()} className={`${btnOutline} text-bad`}>
            {busy ? "Removing…" : `Remove ${first}`}
          </button>
          {error ? <span role="alert" className="text-xs text-bad">{error}</span> : null}
        </>
      )}
    </Confirm>
  ) : (
    <button type="button" onClick={() => setAsk(true)} className={`${btnDanger} sm:ml-auto`}>
      Remove from team
    </button>
  );
}

function Editor({ p, today, onClose, ownerName }: { p: Person; today: string; onClose: () => void; ownerName: string }) {
  const first = p.label.split(" ")[0];
  const cur = p.rate;
  const [rate, setRate] = useState({ hourly: cur?.hourly?.toFixed(2) ?? "", bonus: cur?.outcomeBonus?.toFixed(2) ?? "", currency: cur?.currency ?? "USD", from: today });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removeRate, setRemoveRate] = useState<string | null>(null);
  const field = (k: keyof typeof rate) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setRate((r) => ({ ...r, [k]: e.target.value }));
    setTouched(true);
  };
  const correct = (h: PersonHistory) => {
    setRate({ hourly: h.hourly?.toFixed(2) ?? "", bonus: h.outcomeBonus?.toFixed(2) ?? "", currency: h.currency, from: h.from });
    setTouched(true);
  };
  return (
    <div className="mt-3 space-y-4 border-t border-dashed border-line pt-4">
      <form action="/api/settings" method="post" onSubmit={() => setBusy(true)} className="space-y-4">
        <input type="hidden" name="action" value="person" />
        <input type="hidden" name="userId" value={p.id} />
        {p.may.name ? (
          <label className={fieldLabel}>
            Name
            <input name="name" defaultValue={p.name} maxLength={80} required placeholder="Full name" className={control} />
          </label>
        ) : (
          <p className="text-sm">
            <span className="text-xs font-medium text-muted">Name</span>
            <br />
            {p.label} <span className="text-muted">(they or an owner or manager can change it)</span>
          </p>
        )}
        <div className="text-sm">
          <span className="text-xs font-medium text-muted">Email</span>
          <p>{p.email}</p>
          <p className="text-xs text-muted">The email can&apos;t be changed here: remove {first} and add them again with the new address.</p>
        </div>
        {p.may.role ? (
          <label className={fieldLabel}>
            Role
            <select name="role" defaultValue={p.role} className={control}>
              <option value="member">Member</option>
              <option value="manager">Manager</option>
            </select>
          </label>
        ) : null}
        {p.may.offBoard ? (
          // the owner's switch, for a second account of their own (the owner is never on the team's board)
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="hidden" name="offBoardTouched" value="1" />
            <input type="checkbox" name="offBoard" value="1" defaultChecked={!!p.offBoard} className="size-5" />
            Not on the team board: left off This week&apos;s lists, its totals and the leaderboard (their statement and queue stay)
          </label>
        ) : null}
        {p.may.rate && cur ? (
          <fieldset className="min-w-0 space-y-3 rounded-xl border border-line p-3">
            <legend className="px-1 text-sm font-semibold">Pay rate</legend>
            <RateLine r={cur} />
            <input type="hidden" name="rateTouched" value={touched ? "1" : "0"} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className={fieldLabel}>
                Hourly
                <input name="hourly" type="number" step="0.01" min={0} inputMode="decimal" value={rate.hourly} onChange={field("hourly")} className={control} />
              </label>
              <label className={fieldLabel}>
                Bonus
                <input name="outcomeBonus" type="number" step="0.01" min={0} inputMode="decimal" value={rate.bonus} onChange={field("bonus")} className={control} />
              </label>
              <label className={fieldLabel}>
                Currency
                <input name="currency" maxLength={3} value={rate.currency} onChange={field("currency")} className={`${control} uppercase`} />
              </label>
              <label className={fieldLabel}>
                From
                <input name="effectiveFrom" type="date" value={rate.from} onChange={field("from")} className={control} />
              </label>
            </div>
            <p className="text-xs text-muted">A new rate applies from its date. Weeks already approved keep the rate they were paid at. Leave these as they are to keep the rate.</p>
            {p.history.length ? (
              // a list of rows that wrap (in a table the Remove button ran past the box at phone width): the date
              // and amounts first, the actions or the locked note beside them when there is room, under them when not
              <div className="text-sm">
                <p className="text-xs font-medium text-muted">{first}&apos;s rates, newest first</p>
                <ul className="mt-1">
                  {[...p.history].reverse().map((h) => (
                    <li key={h.from} className="flex flex-wrap items-center justify-between gap-x-4 border-t border-line py-1">
                      <span className="tabular-nums">
                        <span className="whitespace-nowrap">from {h.from}</span> · {h.hourly?.toFixed(2) ?? "-"}/h · bonus {h.outcomeBonus?.toFixed(2) ?? "-"}
                      </span>
                      {h.locked ? (
                        <span className="text-xs text-muted">locked: approved weeks</span>
                      ) : (
                        <span className="inline-flex gap-4">
                          <button type="button" onClick={() => correct(h)} aria-label={`Correct the rate from ${h.from}`} className={btnText}>
                            Correct
                          </button>
                          <button type="button" onClick={() => setRemoveRate(h.from)} aria-label={`Remove the rate from ${h.from}`} className={btnDanger}>
                            Remove
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </fieldset>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={busy} className={btnPrimary}>
            Save
          </button>
          <button type="button" onClick={onClose} className={btnOutline}>
            Cancel
          </button>
          <PixelLoader inline active={busy} label="Saving…" />
        </div>
      </form>
      {removeRate ? (
        <form action="/api/settings" method="post" onSubmit={() => setBusy(true)}>
          <input type="hidden" name="action" value="removeRate" />
          <input type="hidden" name="userId" value={p.id} />
          <input type="hidden" name="effectiveFrom" value={removeRate} />
          <Confirm text={`Remove the rate from ${removeRate}? Hours from that day on use the rate before it.`} act="Remove the rate" onKeep={() => setRemoveRate(null)}>
            {() => <button className={`${btnOutline} text-bad`}>Remove the rate</button>}
          </Confirm>
        </form>
      ) : null}
      {p.may.copySignIn || p.may.remove ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:flex-wrap sm:items-center">
          {p.may.copySignIn ? <CopySignIn email={p.email} name={p.name} ownerName={ownerName} /> : null}
          {p.may.remove ? <RemoveFromTeam userId={p.id} first={first} /> : null}
        </div>
      ) : null}
    </div>
  );
}

export default function PeopleList({ people, today, ownerName }: { people: Person[]; today: string; ownerName: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul aria-label="The team" className="divide-y divide-line rounded-2xl bg-panel">
      {people.map((p) => {
        const editable = p.active && (p.may.name || p.may.role || p.may.rate || p.may.remove || p.may.copySignIn || !!p.may.offBoard);
        const isOpen = open === p.id;
        return (
          <li key={p.id} className={`p-4 ${p.active ? "" : "opacity-60"} ${p.nameMissing && p.isMe ? "rounded-2xl ring-2 ring-accent" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-semibold">
                  {p.label}
                  {!p.active ? <span className={`${badge} bg-bg font-normal text-muted`}>Removed (add them again to restore)</span> : p.invited ? <span className={`${badge} bg-accent-tint font-normal`}>Invited, not signed in yet</span> : null}
                </p>
                {p.name ? <p className="truncate text-sm text-muted">{p.email}</p> : null}
              </div>
              <div className="flex items-center gap-2">
                {p.offBoard ? <span className={`${badge} bg-bg text-muted`}>Not on the team board</span> : null}
                <span className={`${badge} bg-bg text-muted capitalize`}>{p.role}</span>
                {editable ? (
                  <button type="button" aria-expanded={isOpen} aria-controls={`edit-${p.id}`} onClick={() => setOpen(isOpen ? null : p.id)} className={btnOutline}>
                    {isOpen ? "Close" : "Edit"}
                  </button>
                ) : null}
              </div>
            </div>
            {p.nameMissing && p.active && !isOpen ? (
              <p data-name-missing className="mt-2 rounded-lg border-l-4 border-accent bg-bg px-3 py-2 text-sm">
                <span className="font-semibold">Name missing:</span> shows as &ldquo;{p.label}&rdquo; on packs, Sent by, statements and This week.{p.isMe ? " This is you." : ""}
                {editable ? " Edit to add it." : ""}
              </p>
            ) : null}
            {/* the current rate once: here while closed, in the Pay rate box while open */}
            {p.rate && p.may.seePay && !isOpen ? (
              <div className="mt-1">
                <RateLine r={p.rate} />
              </div>
            ) : null}
            {isOpen ? (
              <div id={`edit-${p.id}`}>
                <Editor p={p} today={today} onClose={() => setOpen(null)} ownerName={ownerName} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
