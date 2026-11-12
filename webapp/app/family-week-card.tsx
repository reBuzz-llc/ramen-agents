import { BOTS_DIR } from "@/lib/bots";
import { readFamilyWeek } from "@/lib/family-week";

/** "This week in the family" (creatorCC queue 381): the newest Sunday post, under the world and the list view. */
export default async function FamilyWeekCard() {
  const w = await readFamilyWeek(BOTS_DIR);
  return (
    <section aria-labelledby="family-week" className="rounded-xl bg-panel px-4 py-3">
      <h2 id="family-week" className="text-sm font-semibold text-ink">
        This week in the family
      </h2>
      {w ? (
        <a data-family-week href={w.url} target="_blank" rel="noreferrer" className="mt-1 block hover:underline">
          <span className="block font-semibold text-ink">{w.title}</span>
          {w.summary ? <span className="mt-0.5 block text-sm text-muted">{w.summary}</span> : null}
          <span className="mt-1 block text-sm font-semibold text-[#c55300] dark:text-[#ff8a3d]">Read the week →</span>
        </a>
      ) : (
        <p className="mt-1 text-sm text-muted">No week written yet: the post comes each Sunday.</p>
      )}
    </section>
  );
}
