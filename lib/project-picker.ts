// The clock's project picker, as pure functions: no database here, so the browser can use it too.

export const GENERAL = "General";
export type Project = { id: string; name: string; client: string; active: boolean; cadenceHistory?: { from: string; minutes: number | null }[] };

export type PickerOption = { id: string | null; name: string; client: string; recent: boolean };

/** What the clock's project picker lists for a typed query: the person's recent projects first, then the other active
 *  ones by name, General among them; archived projects never. Every word typed must appear in the name or the client.
 *  `create` is the name to offer as "Create '...'" when nothing is named exactly that. */
export function pickerOptions(active: Project[], recent: (string | null)[], query: string): { options: PickerOption[]; create: string | null } {
  const all: PickerOption[] = [{ id: null, name: GENERAL, client: "", recent: false }, ...active.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, client: p.client, recent: false }))];
  for (const o of all) o.recent = recent.includes(o.id);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = all.filter((o) => words.every((w) => `${o.name} ${o.client}`.toLowerCase().includes(w)));
  const rank = (o: PickerOption) => (o.recent ? recent.indexOf(o.id) : recent.length + 1);
  hits.sort((a, b) => rank(a) - rank(b) || (a.id === null ? -1 : b.id === null ? 1 : a.name.localeCompare(b.name)));
  const typed = query.trim().slice(0, 80);
  const exact = all.some((o) => o.name.toLowerCase() === typed.toLowerCase());
  return { options: hits, create: typed && !exact ? typed : null };
}

/** The project the clock preselects: the running shift's while clocked in; else the one the
 *  person just chose; else their last-used project if it is still open for time; else General (null). */
export function defaultProject(o: { openProjectId?: string | null; clockedIn: boolean; picked: string | null | undefined; last: string | null; projects: Project[] }): string | null {
  if (o.clockedIn) return o.openProjectId ?? null;
  if (o.picked !== undefined) return o.picked;
  if (o.last && o.projects.some((p) => p.id === o.last && p.active)) return o.last;
  return null;
}

/** The dropdown's choices: recent ones first (General among them if used), then the other open projects by name. */
export function dropdownOptions(projects: Project[], recent: (string | null)[]): { recent: PickerOption[]; rest: PickerOption[] } {
  const { options } = pickerOptions(projects, recent, "");
  return { recent: options.filter((o) => o.recent), rest: options.filter((o) => !o.recent) };
}
