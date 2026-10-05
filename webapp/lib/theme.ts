// Appearance preference: System (follow the device), Light or Dark. Stored in a cookie so the server renders
// <html data-theme> and the page never flashes the wrong appearance; applied instantly on the client.
export type ThemeChoice = "system" | "light" | "dark";
export const THEME_COOKIE = "theme";
export const THEME_COLORS = { light: "#f2f2f7", dark: "#000000" } as const;

export function parseTheme(value: string | undefined): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

/** Client only: remember the choice for a year and apply it without a reload. */
export function applyTheme(choice: ThemeChoice): void {
  document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=31536000; samesite=lax`;
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  // Keep Safari's bar and the Home Screen status area in step with the page. The theme-color tags belong to
  // React (Next metadata), so edit them in place; extra tags this function needs are its own and marked.
  const wanted: { color: string; media?: string }[] =
    choice === "system"
      ? [
          { color: THEME_COLORS.light, media: "(prefers-color-scheme: light)" },
          { color: THEME_COLORS.dark, media: "(prefers-color-scheme: dark)" },
        ]
      : [{ color: THEME_COLORS[choice] }];
  document.querySelectorAll('meta[name="theme-color"][data-theme-extra]').forEach((m) => m.remove());
  const managed = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  const set = (meta: HTMLMetaElement, w: { color: string; media?: string }) => {
    meta.content = w.color;
    if (w.media) meta.media = w.media;
    else meta.removeAttribute("media");
  };
  managed.forEach((meta, i) => set(meta, wanted[Math.min(i, wanted.length - 1)]));
  for (const w of wanted.slice(managed.length)) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.dataset.themeExtra = "";
    set(meta, w);
    document.head.appendChild(meta);
  }
  window.dispatchEvent(new CustomEvent("themechange", { detail: choice }));
}

// Liquid Glass look: 0 (clear) to 100 (tinted), like iOS 27's slider. Default 46 matches the kit's glass.
export const GLASS_COOKIE = "glass";
export const GLASS_DEFAULT = 46;

export function parseGlass(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && value !== undefined && value !== "" ? Math.max(0, Math.min(100, Math.round(n))) : GLASS_DEFAULT;
}

export function applyGlass(value: number): void {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  document.cookie = `${GLASS_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.style.setProperty("--glass-t", String(v / 100));
}
