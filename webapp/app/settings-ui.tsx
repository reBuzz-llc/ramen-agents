// Settings building blocks shared by the client shell and the server-rendered pages (no "use client", so the
// section list stays a plain value on the server).
import Link from "next/link";
import { Icon } from "./ui";

export const SETTINGS_SECTIONS = [
  { href: "/settings/appearance", label: "Appearance", detail: "Light, dark or automatic", icon: "circle-half", tile: "bg-sys-blue" },
  { href: "/settings/providers", label: "Key providers", detail: "Every key: availability, usage and limits", icon: "sparkles", tile: "bg-sys-purple" },
  { href: "/settings/notifications", label: "Notifications", detail: "Alerts from your bots", icon: "bell", tile: "bg-sys-red" },
  { href: "/settings/reports", label: "Reports", detail: "The team's week and the refusal report", icon: "chart", tile: "bg-[#ff6600]" },
  { href: "/settings/remote", label: "Remote access", detail: "Open it from your iPhone", icon: "link", tile: "bg-sys-green" },
  { href: "/settings/about", label: "About", detail: "Versions and design kit", icon: "info", tile: "bg-sys-gray" },
] as const;

/** A section row: a colored icon tile, a label and a chevron, as in iOS Settings. */
export function SectionRow({ section, active = false, compact = false }: { section: (typeof SETTINGS_SECTIONS)[number]; active?: boolean; compact?: boolean }) {
  return (
    <Link
      href={section.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-[0.875rem] px-3 transition-colors ${compact ? "py-2" : "py-2.5"} ${active ? "bg-sys-blue text-white" : "text-ink hover:bg-fill-3"}`}
    >
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-white ${section.tile}`}>
        <Icon name={section.icon} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{section.label}</span>
        {compact ? null : <span className={`block truncate text-xs ${active ? "text-white/80" : "text-muted"}`}>{section.detail}</span>}
      </span>
      <Icon name="chevron-right" className={`h-3.5 w-3.5 ${active ? "text-white/80" : "text-muted"}`} />
    </Link>
  );
}

/** The top of one settings section: same title-block height as every other page. */
export function SettingsPage({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <>
      <div className="mb-5 flex h-[4.75rem] items-end pt-2">
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-bold text-ink">{title}</h1>
          <p className="mt-0.5 h-5 truncate text-sm text-muted">{subtitle ?? " "}</p>
        </div>
      </div>
      <div className="space-y-5">{children}</div>
    </>
  );
}
