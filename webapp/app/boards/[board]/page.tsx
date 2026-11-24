import { notFound, redirect } from "next/navigation";
import { currentIdentity } from "@/lib/identity";
import { allRows, FIELDS, RATE_FIELDS, type Board } from "@/lib/local-board";
import { leadsSource } from "@/lib/portal-config";
import PageShell from "../../page-shell";
import BoardView from "../board-view";

export const dynamic = "force-dynamic";
const NAMES: Record<string, string> = { leads: "Leads", tasks: "Tasks", packages: "Packages" };
/** Peek on this Mac (sh scripts/peek.sh setup): each board's own page there. */
const PEEK_HERE = /^https?:\/\/(127\.0\.0\.1|localhost):3100$/;
const PEEK_PAGE: Record<string, string> = { leads: "/leads", tasks: "/queue", packages: "/packages" };

export async function generateMetadata({ params }: { params: Promise<{ board: string }> }) {
  return { title: `${NAMES[(await params).board] ?? "Boards"} · Boards · Bot Dashboard` };
}

// The local board's pages: the rows the agents and people share, read straight from the board's file.
export default async function BoardPage({ params }: { params: Promise<{ board: string }> }) {
  const board = (await params).board;
  if (!(board in NAMES)) notFound();
  const src = await leadsSource();
  const local = src.store === "local";
  // the team's board is Peek on this Mac: its page for this board, not the local board's (which is not in use)
  if (!local && PEEK_HERE.test(src.url)) redirect(`${src.url}${PEEK_PAGE[board]}`);
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
