import { beforeAll, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/db";
import { boardRows } from "@/lib/db/schema";
import { OUR_SIDE, publicReason, ShownError } from "@/lib/errors";
import { NotionError } from "@/lib/notion";
import { boardsFrom, idFromInput, missingLeadsColumns, REJECTED } from "@/lib/notion-pick";
import { cachedBoard, connectNotion, createTenant, disconnectNotion, notionOf } from "@/lib/tenants";

beforeAll(() => {
  process.env.TEAMS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

const ID = "00000000-0000-4000-8000-000000000303";

describe("finding a board's id", () => {
  it("reads an id with or without dashes, or a whole Notion link", () => {
    expect(idFromInput("00000000000040008000000000000303")).toBe(ID);
    expect(idFromInput(` ${ID} `)).toBe(ID);
    expect(idFromInput("https://www.notion.so/team/Leads-00000000000040008000000000000303?v=00000000000040008000000000000300")).toBe(ID);
    // a slug ending in letters that are hex digits is not part of the id
    expect(idFromInput("https://www.notion.so/team/Feed-00000000000040008000000000000303")).toBe(ID);
    expect(idFromInput("my leads board")).toBeNull();
    expect(idFromInput("It does not look like a token at all, really")).toBeNull();
  });
});

describe("the board list", () => {
  const ds = (id: string, title: string, cols: string[], extra = {}) => ({
    object: "data_source",
    id,
    title: [{ plain_text: title }],
    properties: Object.fromEntries(cols.map((c) => [c, { type: "rich_text" }])),
    ...extra,
  });
  it("puts boards that look like Leads first, leaves out trashed ones and pages", () => {
    const b = boardsFrom([
      ds("1", "Tasks", ["Name", "Status", "Assign"]),
      ds("2", "Leads", ["Business", "Status", "Draft email"]),
      ds("3", "Old leads", ["Status", "Draft email"], { in_trash: true }),
      { object: "page", id: "4", properties: {} },
    ]);
    expect(b.map((x) => x.title)).toEqual(["Leads", "Tasks"]);
    expect(b[0].leadsLike).toBe(true);
    expect(b[1].tasksLike).toBe(true);
    expect(missingLeadsColumns(b[1])).toEqual(["Draft email"]);
  });
});

describe("connect and disconnect", () => {
  it("connect shows the card's facts; disconnect deletes the token and the cached rows", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "O" });
    await connectNotion(db, tenant.id, "ntn_abc", { id: ID, title: "Leads" }, null, "Peek bot");
    await db.insert(boardRows).values({ tenantId: tenant.id, pageId: "p1", data: { id: "p1", properties: {} } });
    const n = await notionOf(db, tenant.id);
    expect(n).toMatchObject({ leadsTitle: "Leads", tasks: null, integrationName: "Peek bot", fromDevFile: false });
    expect((await cachedBoard(db, tenant.id)).rows).toHaveLength(1);

    // another Leads board: the old board's cached rows go
    await connectNotion(db, tenant.id, "ntn_abc", { id: "00000000-0000-4000-8000-000000000300", title: "Other" });
    expect((await cachedBoard(db, tenant.id)).rows).toHaveLength(0);

    await db.insert(boardRows).values({ tenantId: tenant.id, pageId: "p2", data: { id: "p2", properties: {} } });
    await disconnectNotion(db, tenant.id);
    expect(await notionOf(db, tenant.id)).toBeNull();
    expect((await cachedBoard(db, tenant.id)).rows).toHaveLength(0);
  });
});

describe("what a page may say when something fails", () => {
  it("never shows a failed query; shows Notion's refusal and our own messages", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const sql = new Error('Failed query: select "id", "token_encrypted" from "notion_connections" where "tenant_id" = $1\nparams: 9f1c...');
    expect(publicReason(sql, "test")).toBe(OUR_SIDE);
    expect(log).toHaveBeenCalledOnce(); // the detail is in the server log
    expect(publicReason(new NotionError(401, "API token is invalid."), "test")).toBe(REJECTED);
    expect(publicReason(new ShownError("No Notion board connected yet."), "test")).toBe("No Notion board connected yet.");
    log.mockRestore();
  });
});
