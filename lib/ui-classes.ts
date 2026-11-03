// Class names shared by server and client components (a "use client" module cannot hand plain values to a server page).
// One scale for every page: controls 44 px, text in inputs 16 px (iOS Safari zooms
// below that), labels 13 px in sentence case, capsule buttons, and the brand orange only on the page's one primary action.

/** Every form control: 44 px high, 16 px text, the same border and radius. */
export const control = "h-11 w-full rounded-xl border border-line bg-panel px-3 text-base text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50";
/** A label above its control, 4 px apart. */
export const fieldLabel = "flex min-w-0 flex-col gap-1 text-xs font-medium text-muted";
export const labelText = "text-xs font-medium text-muted";

/** The page's one primary action: the brand orange, near-black label, semibold. */
export const btnPrimary =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-base font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";
/** Every other button: an outline capsule. */
export const btnOutline =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line bg-panel px-4 text-sm font-semibold text-ink hover:border-accent active:bg-accent-tint disabled:cursor-not-allowed disabled:opacity-50";
/** A text button, still 44 px tall to tap. */
export const btnText = "inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50";
/** A destructive action: red text, never the prominent style. */
export const btnDanger = "inline-flex min-h-11 items-center gap-1 text-sm font-medium text-bad hover:underline disabled:cursor-not-allowed disabled:opacity-50";

/** A page's title block: the same on every page. */
export const pageTitle = "text-2xl font-bold tracking-tight sm:text-[1.75rem]";
export const pageLead = "mt-1 text-[0.9375rem] text-muted";
/** A section title inside a page, and its helper line. */
export const sectionTitle = "text-lg font-semibold";
export const helper = "mt-1 text-sm text-muted";
