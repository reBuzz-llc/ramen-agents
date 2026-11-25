// The top of every Settings page: its title, its one-line description and the message a form came back with (a
// dismissible notice that leaves the address after the first render).
import { pageLead, pageTitle } from "@/lib/ui-classes";
import { settingsPage } from "@/lib/settings-nav";
import Notice from "./notice";

export default function SectionHead({ slug, msg }: { slug: string; msg?: string | string[] }) {
  const p = settingsPage(slug);
  return (
    <header>
      <h1 className={pageTitle}>{p.label}</h1>
      <p className={pageLead}>{p.lead}</p>
      {msg ? <Notice msg={String(msg)} /> : null}
    </header>
  );
}
