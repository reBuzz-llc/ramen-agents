"use client";
// The filters above Our queue's leads. Each select lists what is on the board now, with counts; "Clear" resets all.
import { control, Field } from "../ui";
import { choices, industryGroup, NO_FILTERS, placeOf, type Filterable, type Filters } from "@/lib/lead-filters";


// One grid for the whole bar: 12 columns on a wide screen (search 4, each choice 2), 6 on a tablet, 2 on a phone.
const choice = "col-span-1 sm:col-span-2";
// The 12 columns start at 768 px: the page's content is at most about 980 px wide.

function Pick(p: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Field label={p.label} className={choice}>
      <select value={p.value} onChange={(e) => p.onChange(e.target.value)} className={`${control} ${p.value ? "border-accent" : ""}`}>
        <option value="">Any</option>
        {p.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export default function FilterBar({ rows, f, set, shown, total }: { rows: Filterable[]; f: Filters; set: (f: Filters) => void; shown: number; total: number }) {
  const on = (k: keyof Filters) => (v: string) => set({ ...f, [k]: v, ...(k === "state" ? { city: "" } : {}) });
  const counted = (list: { value: string; count: number }[]) => list.map((c) => ({ value: c.value, label: `${c.value} (${c.count})` }));
  const states = counted(choices(rows, (r) => placeOf(r.location).state || "Unknown"));
  // Cities of the chosen state only, so the list stays short.
  const cities = counted(choices(f.state ? rows.filter((r) => (placeOf(r.location).state || "Unknown") === f.state) : [], (r) => placeOf(r.location).city));
  const active = Object.entries(f).some(([, v]) => v);
  return (
    <div className="mt-4 rounded-xl border border-line bg-panel/50 p-4">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-6 md:grid-cols-12">
        <Field label="Search" className="col-span-2 sm:col-span-6 md:col-span-4">
          <input type="search" value={f.q} onChange={(e) => on("q")(e.target.value)} placeholder="business, contact, email, city" className={control} />
        </Field>
        <Pick label="Industry" value={f.industry} onChange={on("industry")} options={counted(choices(rows, (r) => industryGroup(r.industry)))} />
        <Pick label="State" value={f.state} onChange={on("state")} options={states} />
        {f.state && cities.length > 1 ? <Pick label="City" value={f.city} onChange={on("city")} options={cities} /> : null}
        <Pick label="Package" value={f.pkg} onChange={on("pkg")} options={counted(choices(rows, (r) => r.pkg))} />
        <Pick
          label="Lead score"
          value={f.score}
          onChange={on("score")}
          options={[
            { value: "85", label: "85 and up" },
            { value: "70", label: "70 and up" },
            { value: "50", label: "50 and up" },
            { value: "none", label: "Not scored yet" },
          ]}
        />
        <Pick
          label="Reach by"
          value={f.reach}
          onChange={on("reach")}
          options={[
            { value: "email", label: "Has an email" },
            { value: "whatsapp", label: "WhatsApp only" },
            { value: "contact", label: "Has a contact person" },
          ]}
        />
        <Pick
          label="Whose"
          value={f.who}
          onChange={on("who")}
          options={[
            { value: "mine", label: "Mine" },
            { value: "open", label: "Not taken" },
            { value: "others", label: "Taken by others" },
          ]}
        />
        <Pick
          label="Added"
          value={f.added}
          onChange={on("added")}
          options={[
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
          ]}
        />
        <p className="col-span-2 flex min-h-11 items-center justify-end gap-3 self-end text-xs text-muted sm:col-span-6 md:col-span-6">
          <span>
            Showing {shown} of {total} leads
          </span>
          {active ? (
            <button type="button" onClick={() => set(NO_FILTERS)} className="text-accent-ink hover:underline">
              Clear filters
            </button>
          ) : null}
        </p>
      </div>
    </div>
  );
}
