"use client";
// Settings' own nav: a list down the left at 1024 px and up, segmented tabs across the top below
// that. The page you are on is filled and carries aria-current="page", like the top bar.
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { slug: string; label: string };

export default function SettingsNav({ pages }: { pages: Item[] }) {
  const path = usePathname() ?? "";
  const on = (slug: string) => path === `/settings/${slug}` || path.startsWith(`/settings/${slug}/`);
  return (
    <>
      <nav aria-label="Settings" className="hidden lg:block">
        <ul className="space-y-1">
          {pages.map((p) => (
            <li key={p.slug}>
              <Link
                href={`/settings/${p.slug}`}
                aria-current={on(p.slug) ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-xl px-3 text-[0.9375rem] ${on(p.slug) ? "bg-accent-tint font-semibold text-accent-ink" : "text-ink hover:bg-panel"}`}
              >
                {p.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label="Settings" className="-mx-5 overflow-x-auto px-5 lg:hidden">
        <ul className="inline-flex min-w-max gap-1 rounded-full border border-line bg-panel p-1">
          {pages.map((p) => (
            <li key={p.slug}>
              <Link
                href={`/settings/${p.slug}`}
                aria-current={on(p.slug) ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm whitespace-nowrap ${on(p.slug) ? "bg-accent-tint font-semibold text-accent-ink" : "text-muted hover:text-ink"}`}
              >
                {p.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
