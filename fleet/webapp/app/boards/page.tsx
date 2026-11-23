import { redirect } from "next/navigation";

// The boards' home: the Leads board first.
export default function BoardsPage() {
  redirect("/boards/leads");
}
