// The Settings section's frame: its nav beside (or above) the page, and the card that sends people
// to the Clock page for projects.
import Link from "next/link";
import { pageMe } from "@/lib/page-me";
import { settingsFor } from "@/lib/settings-nav";
import SettingsNav from "./settings-nav";

function ProjectsCard({ className }: { className: string }) {
  return (
    <Link href="/#projects" className={`block rounded-2xl bg-panel p-4 text-sm hover:ring-2 hover:ring-accent/40 ${className}`}>
      <span className="block font-semibold text-ink">Projects</span>
      <span className="mt-1 block text-muted">
        Projects are managed on the <span className="text-accent-ink">Clock page</span>, under the clock, where people pick them.
      </span>
    </Link>
  );
}

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const who = await pageMe("/settings");
  const pages = settingsFor(who.role).map(({ slug, label }) => ({ slug, label }));
  return (
    <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <div className="min-w-0 space-y-6">
        <SettingsNav pages={pages} />
        <ProjectsCard className="hidden lg:block" />
      </div>
      <div className="min-w-0 space-y-8">
        {children}
        <ProjectsCard className="lg:hidden" />
      </div>
    </div>
  );
}
