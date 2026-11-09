// The lead drawer shows its empty fields by default: a person sees at once what
// is missing and fills it. "Hide empty fields" hides them, and this browser remembers the choice (localStorage, read in a
// try: a private window or blocked storage falls back to showing them).
export const SHOW_EMPTY_KEY = "peek.drawer.hideEmpty";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Whether the drawer shows empty fields: yes unless this browser chose to hide them. */
export function readShowEmpty(store: Store | null | undefined): boolean {
  try {
    return store?.getItem(SHOW_EMPTY_KEY) !== "1";
  } catch {
    return true;
  }
}

/** Remember the choice; showing (the default) leaves nothing stored. */
export function writeShowEmpty(store: Store | null | undefined, show: boolean): void {
  try {
    if (show) store?.removeItem(SHOW_EMPTY_KEY);
    else store?.setItem(SHOW_EMPTY_KEY, "1");
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
}
