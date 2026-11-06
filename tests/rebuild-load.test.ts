// The the portal rebuild loader's pure parts: the derived lead columns as the portal computes them, the
// dataset's values in the portal's column types, the mirrored What we have split into sections and the rate card.
import { describe, expect, it } from "vitest";
import { domainOf as peekDomain } from "@/lib/leads";
import { placeOf as peekPlace } from "@/lib/lead-filters";
import { cellOf, domainOf, expandMirror, placeOf, splitRates, toColumn } from "../scripts/rebuild-load.mjs";

describe("rebuild-load", () => {
  it("derives domain, city and state exactly as the portal does", () => {
    for (const w of ["https://www.fiestalounge.example/menu", "fiestalounge.example", "", "not a url ::"]) expect(domainOf(w)).toBe(peekDomain(w));
    for (const l of ["Queens, NY 11385, USA", "Bronx, New York", "Brooklyn", "Hoboken, NJ 07030", "Suite 704, Manhattan"]) expect(placeOf(l)).toEqual(peekPlace(l));
  });

  it("reads {value, source, at} or a plain value, and stores values as the portal does (empty is null)", () => {
    expect(cellOf({ value: "x", source: "notion frozen board", at: "2026-11-01" })).toEqual({ value: "x", source: "notion frozen board", at: "2026-11-01" });
    expect(cellOf("plain")).toEqual({ value: "plain", source: "", at: null });
    expect(toColumn("text", "  ")).toBeNull();
    expect(toColumn("text", "")).toBeNull(); // the team's deletion: {"value": ""}
    expect(toColumn("ARRAY", ["Wix", " ", "Toast"])).toEqual(["Wix", "Toast"]);
    expect(toColumn("ARRAY", [])).toBeNull();
    expect(toColumn("double precision", "78")).toBe(78);
    expect(toColumn("date", "2026-11-05T10:00:00Z")).toBe("2026-11-05");
    expect(toColumn("boolean", "true")).toBe(true);
  });

  it("splits a mirrored What we have into its sections and its Rates block into the rate card; packages-page is left out", () => {
    const body = "# What we have (the owner's Notion page, mirrored)\n\nWhat the company actually has ...\nLast edited on Notion: 2026-10-30.\n\nhttps://drive.example/f\n\n## Services\n### Web\n1. Sites\n\n## Rates\nThe internal rate card.\nFrom the portal's Asset page, where the owner edits the rates.\n- Care: $249/month\n- MVP: $4,900\n\n## Goals\nSMB";
    const out = splitRates(expandMirror([{ kind: "section", title: "What we have", section_kind: "text", body, source: "mirror" }, { kind: "section", title: "packages-page", body: "## A\nx" }, { kind: "package", name: "P" }]));
    expect(out.filter((x: { kind: string }) => x.kind === "section").map((x: { title: string; section_kind: string }) => [x.title, x.section_kind])).toEqual([
      ["", "text"],
      ["Services", "text"],
      ["Rates", "rates"],
      ["Goals", "text"],
    ]);
    expect(out.find((x: { title?: string }) => x.title === "")?.body).toBe("https://drive.example/f");
    expect(out.find((x: { title?: string }) => x.title === "Rates")?.body).toBe("The internal rate card.");
    expect(out.filter((x: { kind: string }) => x.kind === "rate").map((x: { line: string }) => x.line)).toEqual(["Care: $249/month", "MVP: $4,900"]);
    expect(out.filter((x: { kind: string }) => x.kind === "package")).toHaveLength(1);
  });
});

describe("the example dataset", () => {
  it("loads into an empty database, and a second run changes nothing", async () => {
    const { memoryDb } = await import("@/lib/db");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { rebuild } = await import("../scripts/rebuild-load.mjs");
    const d = await memoryDb();
    const client = (d as unknown as { $client: { query: (s: string, p?: unknown[]) => Promise<unknown> } }).$client;
    const empty = mkdtempSync(path.join(tmpdir(), "keys-"));
    const opts = { client, dir: path.join(__dirname, "..", "examples", "rebuild"), stamp: "example", ownerEmail: "owner@example.com", keysDir: empty, teamFile: path.join(empty, "none.json"), today: "2026-01-15" };
    type Board = { inserted: number; changed: number; unchanged: number; skipped: number };
    type Report = { leads: Board; tasks: Board; assets: Record<string, string> };
    const first = (await rebuild(opts)) as unknown as Report;
    expect([first.leads.inserted, first.tasks.inserted, first.leads.skipped]).toEqual([2, 1, 0]);
    expect(first.assets).toMatchObject({ asset_rates: "2 written (was 0)", asset_packages: "1 written (was 0)" });
    const second = (await rebuild(opts)) as unknown as Report;
    expect([second.leads.unchanged, second.tasks.unchanged, second.leads.changed]).toEqual([2, 1, 0]);
  });
});
