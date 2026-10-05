// Building blocks every page uses, in the Apple theme (applebrandkit.md): grouped cards in the content layer,
// capsule buttons with a press state, tinted badges, the system activity indicator, and line icons.
import { TONE_DOT, TONE_FILL, TONE_TEXT, type Tone } from "@/lib/status";

/** A card in the content layer: solid, no Liquid Glass (glass is for controls and navigation only). */
export function Panel({
  title,
  aside,
  hint,
  children,
  className = "",
}: {
  title: string;
  aside?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl bg-panel ${className}`}>
      <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-1">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {aside ? <div className="text-xs text-muted">{aside}</div> : null}
      </header>
      <div className="px-4 pt-2 pb-4">
        {hint ? <p className="mb-3 text-sm text-muted">{hint}</p> : null}
        {children}
      </div>
    </section>
  );
}

export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_FILL[tone]} ${TONE_TEXT[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />
      {children}
    </span>
  );
}

/** The iOS activity indicator: eight fading spokes. */
export function Spinner({ small = false }: { small?: boolean }) {
  const s = small ? 12 : 15;
  return (
    <svg viewBox="0 0 24 24" width={s} height={s} className="shrink-0 animate-spin [animation-duration:0.9s] [animation-timing-function:steps(8)]" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <line
          key={i}
          x1="12"
          y1="3"
          x2="12"
          y2="7.5"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          opacity={0.25 + (0.75 * (i + 1)) / 8}
          transform={`rotate(${i * 45} 12 12)`}
        />
      ))}
    </svg>
  );
}

type ButtonKind = "prominent" | "gray" | "tinted" | "destructive" | "plain" | "glass";

const BUTTON: Record<ButtonKind, string> = {
  // The one most likely action in a view: accent background (HIG: color the background, not the label).
  prominent: "bg-sys-blue text-white hover:brightness-110",
  gray: "bg-fill-3 text-ink hover:bg-fill-2",
  tinted: "bg-sys-blue/15 text-accent hover:bg-sys-blue/20",
  destructive: "bg-sys-red/12 text-bad hover:bg-sys-red/18",
  plain: "text-accent hover:bg-fill-3",
  glass: "glass text-ink",
};

/** Class names for a capsule button, for links and buttons alike. */
export function buttonClass(kind: ButtonKind = "gray", size: "sm" | "md" = "md"): string {
  const box = size === "md" ? "h-9 px-4 text-sm [@media(pointer:coarse)]:h-11" : "h-7 px-3 text-xs [@media(pointer:coarse)]:h-9";
  return `pressable hit inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold whitespace-nowrap select-none disabled:cursor-not-allowed disabled:opacity-40 ${box} ${BUTTON[kind]}`;
}

type IconName =
  | "chevron-left"
  | "chevron-down"
  | "chevron-right"
  | "gauge"
  | "chat"
  | "person"
  | "play"
  | "stop"
  | "arrow-clockwise"
  | "copy"
  | "check"
  | "link"
  | "gear"
  | "sun"
  | "moon"
  | "circle-half"
  | "sparkles"
  | "key"
  | "person-circle"
  | "info"
  | "bell"
  | "chart"
  | "question"
  | "note"
  | "flag"
  | "xmark"
  | "plus"
  | "person-2"
  | "grid";

const PATHS: Record<IconName, React.ReactNode> = {
  "chevron-left": <path d="M14.5 5 8 12l6.5 7" />,
  "chevron-right": <path d="M9.5 5 16 12l-6.5 7" />,
  "chevron-down": <path d="M5.5 9 12 15.5 18.5 9" />,
  gauge: (
    <>
      <path d="M4.2 17.5a9 9 0 1 1 15.6 0" />
      <path d="M12 13.2 15.8 8.4" />
      <circle cx="12" cy="13.6" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  chat: <path d="M20 11.5c0 4.1-3.6 7.3-8 7.3-1.1 0-2.1-.2-3-.5L4.5 20l1.2-3.6C4.6 15 4 13.3 4 11.5 4 7.4 7.6 4.2 12 4.2s8 3.2 8 7.3Z" />,
  person: (
    <>
      <circle cx="12" cy="8.2" r="3.7" />
      <path d="M4.8 20c.8-3.8 3.6-5.9 7.2-5.9s6.4 2.1 7.2 5.9" />
    </>
  ),
  play: <path d="M7.5 5.2v13.6a.8.8 0 0 0 1.2.7l11-6.8a.8.8 0 0 0 0-1.4l-11-6.8a.8.8 0 0 0-1.2.7Z" fill="currentColor" stroke="none" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />,
  "arrow-clockwise": (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.8 4.2v4.6h-4.6" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.8" />
      <path d="M15.5 5.6V5.3A2.8 2.8 0 0 0 12.7 2.5H6.3A2.8 2.8 0 0 0 3.5 5.3v6.4a2.8 2.8 0 0 0 2.8 2.8h.3" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
      <circle cx="12" cy="12" r="6.6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7 5.3 5.3" />
    </>
  ),
  moon: <path d="M19.5 14.6A8 8 0 0 1 9.4 4.5 8 8 0 1 0 19.5 14.6Z" />,
  "circle-half": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none" />
    </>
  ),
  sparkles: (
    <>
      <path d="M10 3.5 11.6 8.4 16.5 10 11.6 11.6 10 16.5 8.4 11.6 3.5 10 8.4 8.4Z" />
      <path d="M17.5 14.5 18.3 16.7 20.5 17.5 18.3 18.3 17.5 20.5 16.7 18.3 14.5 17.5 16.7 16.7Z" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15.5" r="4" />
      <path d="M10.9 12.7 19.5 4.1M16.2 7.4l2.6 2.6M13.8 9.8l2 2" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20h16" />
      <path d="M7 16.5v-5M12 16.5V6.5M17 16.5v-8" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.8v.4" />
      <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  note: (
    <>
      <path d="M6 3.5h8l4 4v13H6Z" />
      <path d="M14 3.5v4h4M9 12h6M9 15.5h6" />
    </>
  ),
  flag: (
    <>
      <path d="M5.5 21V4" />
      <path d="M5.5 4.5h11l-2 4 2 4h-11" />
    </>
  ),
  xmark: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  "person-2": (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17 13.7a5.5 5.5 0 0 1 3.5 5.3" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  "person-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3.1" />
      <path d="M6.3 18.6c1.2-2.4 3.2-3.6 5.7-3.6s4.5 1.2 5.7 3.6" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l2.8-2.8a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-2.8 2.8a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
    </>
  ),
};

/** Line icons drawn in the spirit of SF Symbols (SF Symbols themselves are licensed for Apple-platform apps only). */
export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}

/** The iOS switch: a 51 × 31 pt capsule, green when on. */
export function Toggle({ on, onChange, label, disabled = false }: { on: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`hit relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-300 disabled:opacity-40 ${on ? "bg-sys-green" : "bg-fill"}`}
    >
      <span
        className={`absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.15),0_1px_1px_rgb(0_0_0/0.16)] transition-transform duration-300 [transition-timing-function:var(--ease-spring)] ${on ? "translate-x-5" : ""}`}
      />
    </button>
  );
}
