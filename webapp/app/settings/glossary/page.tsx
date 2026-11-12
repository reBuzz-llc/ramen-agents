import { readFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR } from "@/lib/bots";
import { parseGlossary } from "@/lib/glossary";
import { SettingsPage } from "../../settings-ui";
import GlossaryView from "./glossary-view";

export const metadata = { title: "Glossary · Settings" };
export const dynamic = "force-dynamic";

// Settings -> Glossary (owner via creatorCC, queue 488): what is called what and who is who in the family, read-only from
// creatorCC's common-data/glossary.json.
export default async function GlossaryPage() {
  const g = await readFile(/*turbopackIgnore: true*/ path.join(BOTS_DIR, "common-data", "glossary.json"), "utf8")
    .then((t) => parseGlossary(JSON.parse(t)))
    .catch(() => parseGlossary(null));
  const total = g.sections.reduce((n, s) => n + s.items.length, 0);
  return (
    <SettingsPage title="Glossary" subtitle={`Every made-up name in the family: ${total} entries${g.updated ? `, updated ${g.updated}` : ""}`}>
      {g.sections.length ? <GlossaryView sections={g.sections} /> : <p className="text-sm text-muted">The glossary file is not there yet (common-data/glossary.json).</p>}
    </SettingsPage>
  );
}
