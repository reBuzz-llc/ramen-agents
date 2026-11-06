import { redirect } from "next/navigation";

// "Our queue" is gone (the Leads page does the same work): its tasks are the To-do page, its review and
// send lists the Leads page's Send next. Old links still land: a task link (?task=<id>, the bots' and older emails')
// opens it on To-do; anything else goes to Leads.
export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const task = one(sp.task);
  if (task) redirect(`/todo?task=${encodeURIComponent(task)}&status=${encodeURIComponent(one(sp.status))}`);
  redirect("/leads");
}
