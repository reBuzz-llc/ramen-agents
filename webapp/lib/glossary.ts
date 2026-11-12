// The family's names (creatorCC queue 488): every made-up name, "what is called what and who is who", kept by creatorCC in
// common-data/glossary.json ({_note, updated, sections: [{title, items: [{term, what, since?}]}]}); Settings -> Glossary
// shows it read-only with a search across the sections. Pure (the browser's search uses it); the page reads the file.
// Self-contained for the node tests.

export type GlossaryItem = { term: string; what: string; since: string };
export type GlossarySection = { title: string; items: GlossaryItem[] };
export type Glossary = { updated: string; sections: GlossarySection[] };

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** The file's sections, with anything malformed left out; empty when there is no file. */
export function parseGlossary(raw: unknown): Glossary {
  const o = (raw && typeof raw === "object" ? raw : {}) as { updated?: unknown; sections?: unknown };
  const sections = (Array.isArray(o.sections) ? o.sections : [])
    .map((s): GlossarySection => {
      const x = (s ?? {}) as { title?: unknown; items?: unknown };
      return {
        title: str(x.title, 120),
        items: (Array.isArray(x.items) ? x.items : [])
          .map((i) => {
            const y = (i ?? {}) as { term?: unknown; what?: unknown; since?: unknown };
            return { term: str(y.term, 160), what: str(y.what, 1200), since: str(y.since, 20) };
          })
          .filter((i) => i.term),
      };
    })
    .filter((s) => s.title && s.items.length);
  return { updated: str(o.updated, 20), sections };
}

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
/** The sections with only the items whose term or meaning holds every word of the query; empty sections dropped. */
export function filterGlossary(sections: GlossarySection[], query: string): GlossarySection[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return sections;
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => { const t = fold(`${i.term} ${i.what} ${s.title}`); return words.every((w) => t.includes(w)); }) }))
    .filter((s) => s.items.length);
}
