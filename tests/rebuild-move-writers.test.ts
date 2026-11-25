// A move from the starter's local board keeps who wrote each cell: rebuild-load writes one applied history entry per
// column the dataset names a writer for, so Peek's person-wins rule holds after the move (an agent cannot overwrite a
// cell a person set), and a column Peek has no place for is counted, not silently lost.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { apiKeys, leadCells } from "@/lib/db/schema";
import { createHash } from "node:crypto";
import { writeLead } from "@/lib/leads";
import { ensureLocalOwner } from "@/lib/local-mode";
import { openClient } from "../scripts/db-client.mjs";
import { MOVED_BY, rebuild as rebuildJs } from "../scripts/rebuild-load.mjs";

const rebuild = rebuildJs as unknown as (o: Record<string, unknown>) => Promise<{ leads: Record<string, unknown>; keys: string }>;

const dirs: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(path.join(tmpdir(), p));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const ID = "0b3c1a2e-1111-4222-8333-444455556661";
const cell = (value: unknown, by: string, at = "2026-01-11T09:00:00Z") => ({ value, source: "the local board", at, by });

describe("a move from the local board keeps each cell's writer", () => {
  it("a person's cell stays the person's: an agent's write is refused; a bot's cell takes the agent's write; an unknown field is counted", async () => {
    const db0 = tmp("move-db-");
    const made = await memoryDb(db0);
    await ensureLocalOwner(made, {});
    await (made as unknown as { $client: { close: () => Promise<void> } }).$client.close();
    const data = tmp("move-data-");
    writeFileSync(path.join(data, "leads-rebuild-t.jsonl"), JSON.stringify({ id: ID, fields: { business: cell("Sunrise Bakery", "bot"), notes: cell("call after 3", "person", "2026-01-12T10:00:00Z"), pain_point: cell("no website", "bot"), status: cell("Contacted", "person") } }) + "\n");
    const client = await openClient({ pglite: db0, up: async () => false });
    // a starter install's agents hold portal-<name>.key: --keys-prefix portal registers them, so each keeps working
    const keys = tmp("move-keys-");
    const TOKEN = "peek_starter_engine_token_made_up";
    writeFileSync(path.join(keys, "portal-engine.key"), `${TOKEN}\n`);
    writeFileSync(path.join(keys, "peek-validator.key"), "peek_other\n");
    let report: Awaited<ReturnType<typeof rebuild>>;
    try {
      report = await rebuild({ client, dir: data, stamp: "t", keysDir: keys, keysPrefix: "portal", teamFile: path.join(data, "none.json") });
    } finally {
      await (client as unknown as { end: () => Promise<void> }).end();
    }
    expect(report.leads).toMatchObject({ inserted: 1, writers: { person: 1, bot: 2 }, dropped: { status: 1 } });
    expect(report.keys).toMatch(/engine: restored/);
    expect(report.keys).toMatch(/validator: no key file/); // only the prefix asked for is read
    const db = await memoryDb(db0);
    const cells = await db.select().from(leadCells);
    expect(cells.find((c) => c.column === "notes")).toMatchObject({ actorKind: "person", actorName: MOVED_BY, outcome: "applied", new: "call after 3" });
    expect(new Date(cells.find((c) => c.column === "notes")!.at).toISOString()).toBe("2026-01-12T10:00:00.000Z");
    const t = (await db.select({ t: leadCells.tenantId }).from(leadCells).limit(1))[0].t;
    expect((await db.select({ name: apiKeys.name, hash: apiKeys.keyHash }).from(apiKeys))).toEqual([{ name: "engine", hash: createHash("sha256").update(TOKEN).digest("hex") }]);
    const bot = { kind: "bot" as const, name: "Lead Enricher", via: "engine" };
    const r = await writeLead(db, t, { id: ID }, { notes: "agent's note", pain_point: "slow site" }, bot);
    expect(r.ok && [r.lead.notes, r.lead.pain_point]).toEqual(["call after 3", "slow site"]);
    expect(r.ok && r.refused).toEqual([{ field: "notes", reason: "person_wins", current: "call after 3" }]);
    await (db as unknown as { $client: { close: () => Promise<void> } }).$client.close();
  }, 60_000);
});
