import { pageMe } from "@/lib/page-me";
import TodoView from "./todo-view";

export const metadata = { title: "To-do · ramen-agents" };

/** The team's open tasks, on their own page in the bar. */
export default async function TodoPage() {
  await pageMe("/todo");
  return <TodoView />;
}
