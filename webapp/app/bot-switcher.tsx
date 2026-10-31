"use client";
import type { BotProfile } from "@/lib/bot";

// Icon-tile gradients in the system palette, one per bot, so each bot is recognisable at a glance.
const AVATAR_TONES = [
  "from-sys-blue to-sys-indigo",
  "from-sys-teal to-sys-blue",
  "from-sys-orange to-sys-red",
  "from-sys-green to-sys-teal",
  "from-sys-purple to-sys-indigo",
];

function avatarTone(slug: string): string {
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function Avatar({ bot, size = "md" }: { bot: Pick<BotProfile, "slug" | "handle">; size?: "xs" | "sm" | "md" }) {
  // Four characters (ceoB), so a touch smaller than the two-letter initials it replaces.
  const box = size === "md" ? "h-10 w-10 rounded-[11px] text-[12px]" : size === "sm" ? "h-8 w-8 rounded-[9px] text-[10.5px]" : "h-7 w-7 rounded-full text-[9px]";
  return (
    <span className={`grid shrink-0 place-items-center bg-gradient-to-br font-rounded font-bold tracking-tight text-white ${box} ${avatarTone(bot.slug)}`} aria-hidden>
      {bot.handle}
    </span>
  );
}
