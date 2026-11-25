import { redirect } from "next/navigation";

// "Our queue" is gone (the Leads page does the same work), and so is To-do: every old link, a task link (?task=<id>) too, lands on Leads.
export default function QueuePage() {
  redirect("/leads");
}
