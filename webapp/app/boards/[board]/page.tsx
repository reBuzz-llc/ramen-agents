import { notFound } from "next/navigation";
import { currentIdentity } from "@/lib/identity";
import { allRows, FIELDS, RATE_FIELDS, type Board } from "@/lib/local-board";
import { leadsSource } from "@/lib/portal-config";
import PageShell from "../../page-shell";
import BoardView from "../board-view";

export const dynamic = "force-dynamic";
const NAMES: Record<string, string> = { leads: "Leads", tasks: "Tasks", packages: "Packages" };

export async function generateMetadata({ params }: { params: Promise<{ board: string }> }) {
  return { title: `${NAMES[(await params).board] ?? "Boards"} · Boards · Bot Dashboard` };
}

// The local board's pages (queue 572): the rows the agents and people share, read straight from the board's file.
export default async function BoardPage({ params }: { params: Promise<{ board: string }> }) {
  const board = (await params).board;
  if (!(board in NAMES)) notFound();
  const src = await leadsSource();
  const local = src.store === "local";
  const b = board as Board;
  return (
    <PageShell identity={await currentIdentity()} title="Boards">
      <BoardView
        board={b}
        rows={local ? allRows(b) : []}
        fields={FIELDS[b]}
        rates={b === "packages" && local ? allRows("rates") : undefined}
        rateFields={b === "packages" ? RATE_FIELDS : undefined}
        local={local}
        portal={src.url}
      />
    </PageShell>
  );
}
