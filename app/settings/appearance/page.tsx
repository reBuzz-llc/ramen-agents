import { cookies } from "next/headers";
import { pageMe } from "@/lib/page-me";
import { TEXT_COOKIE, TEXT_SIZES, textOf, THEME_COOKIE, THEMES, themeOf } from "@/lib/appearance";
import { settingsTitle } from "@/lib/settings-nav";
import { btnPrimary, helper, sectionTitle } from "@/lib/ui-classes";
import { PendingForm } from "../../ui";
import SectionHead from "../section-head";

export const metadata = { title: settingsTitle("appearance") };

const option = "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line bg-panel px-4 py-2 text-[0.9375rem] has-[:checked]:border-accent has-[:checked]:bg-accent-tint has-[:checked]:font-semibold";

export default async function Appearance(props: PageProps<"/settings/appearance">) {
  await pageMe("/settings/appearance");
  const msg = (await props.searchParams).msg;
  const jar = await cookies();
  const theme = themeOf(jar.get(THEME_COOKIE)?.value);
  const text = textOf(jar.get(TEXT_COOKIE)?.value);
  return (
    <>
      <SectionHead slug="appearance" msg={msg} />
      <PendingForm action="/api/appearance" method="post" className="space-y-8">
        <fieldset>
          <legend className={sectionTitle}>Theme</legend>
          <p className={helper}>&quot;Same as this device&quot; follows your phone or computer when it switches between light and dark.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {THEMES.map((t) => (
              <label key={t.value} className={option}>
                <input type="radio" name="theme" value={t.value} defaultChecked={theme === t.value} className="size-5 accent-[var(--color-accent)]" />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className={sectionTitle}>Text size</legend>
          <p className={helper}>Makes every page&apos;s text and controls bigger in this browser.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {TEXT_SIZES.map((t) => (
              <label key={t.value} className={option}>
                <input type="radio" name="text" value={t.value} defaultChecked={text === t.value} className="size-5 accent-[var(--color-accent)]" />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>
        <button className={btnPrimary}>Save</button>
      </PendingForm>
    </>
  );
}
