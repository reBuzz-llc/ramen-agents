"use client";

export const compact = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K` : n.toLocaleString());

/** An iOS segmented control (radio group). */
export function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-full bg-fill-3 p-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={o.key === value}
          onClick={() => onChange(o.key)}
          className={`pressable h-8 min-w-0 flex-1 truncate rounded-full sm:flex-none sm:overflow-visible px-3 text-xs font-semibold whitespace-nowrap transition-colors sm:px-4 ${o.key === value ? "bg-[var(--seg-thumb)] text-ink shadow-[0_1px_3px_rgb(0_0_0/0.14)]" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
