// The top of every Settings page: its title, its one-line description and the message a form came back with.
import { pageLead, pageTitle } from "@/lib/ui-classes";
import { settingsPage } from "@/lib/settings-nav";

export default function SectionHead({ slug, msg }: { slug: string; msg?: string | string[] }) {
  const p = settingsPage(slug);
  return (
    <header>
      <h1 className={pageTitle}>{p.label}</h1>
      <p className={pageLead}>{p.lead}</p>
      {msg ? (
        <p role="status" className="mt-4 rounded-xl bg-accent-tint p-3 text-[0.9375rem] text-ink">
          {String(msg)}
        </p>
      ) : null}
    </header>
  );
}
