"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Identity } from "@/lib/identity";
import { PAGE_WIDTH } from "./chrome-shell";
import ProfileMenu from "./profile-menu";
import { SectionRow, SETTINGS_SECTIONS } from "./settings-ui";
import { Icon } from "./ui";

/**
 * Settings in the same frame as the bot pages: a glass toolbar (back, title, profile), then a sidebar of
 * sections beside the selected section on wide screens. On phones /settings is the list and each section is
 * its own screen with a back button, like iOS Settings.
 */
export default function SettingsShell({ identity, backHref, backLabel, children }: { identity: Identity; backHref: string; backLabel: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const onIndex = pathname === "/settings";
  // The index shows Appearance on wide screens, so highlight it there.
  const current = onIndex ? "/settings/appearance" : pathname;

  return (
    <>
      <header className="pt-safe fixed inset-x-0 top-0 z-30">
        <div className="scroll-edge-top pointer-events-none absolute inset-x-0 top-0 h-[calc(env(safe-area-inset-top)+5.5rem)]" aria-hidden />
        <div className={`relative mx-auto flex ${PAGE_WIDTH} items-center gap-2 px-3 pt-2 pb-2 sm:px-5`}>
          <div className="flex min-w-0 flex-1 items-center">
            {!onIndex ? (
              <Link href="/settings" className="glass pressable flex h-11 items-center gap-1 rounded-full pr-4 pl-2.5 text-sm font-semibold text-ink lg:hidden">
                <Icon name="chevron-left" className="h-4 w-4" />
                Settings
              </Link>
            ) : null}
            <Link href={backHref} className={`glass pressable h-11 min-w-0 items-center gap-1 rounded-full pr-4 pl-2.5 text-sm font-semibold text-ink ${onIndex ? "flex" : "hidden lg:flex"}`}>
              <Icon name="chevron-left" className="h-4 w-4 shrink-0" />
              <span className="truncate">{backLabel}</span>
            </Link>
          </div>
          <div className="hidden h-11 shrink-0 items-center px-5 text-base font-semibold text-ink sm:flex">Settings</div>
          <div className="flex h-11 min-w-0 flex-1 items-center justify-end">
            <ProfileMenu identity={identity} />
          </div>
        </div>
      </header>

      <main className={`mx-auto ${PAGE_WIDTH} px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] pb-[calc(env(safe-area-inset-bottom)+2.5rem)] sm:px-6 sm:pb-10`}>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <nav aria-label="Settings sections" className="hidden lg:sticky lg:top-[calc(env(safe-area-inset-top)+4.5rem)] lg:block lg:self-start">
            {/* Same height as the section's title block, so the list lines up with the first card. */}
            <div className="mb-5 h-[4.75rem]" aria-hidden />
            <div className="space-y-0.5 rounded-xl bg-panel p-1.5">
              {SETTINGS_SECTIONS.map((s) => (
                <SectionRow key={s.href} section={s} active={s.href === current} compact />
              ))}
            </div>
          </nav>
          <div className="min-w-0">{children}</div>
        </div>
      </main>
    </>
  );
}
