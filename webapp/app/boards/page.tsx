import { redirect } from "next/navigation";

// The boards' home: the Leads board first (queue 572).
export default function BoardsPage() {
  redirect("/boards/leads");
}
