import { pageMe } from "@/lib/page-me";
import QueueView from "./queue-view";

export const metadata = { title: "Our queue · ramen-agents" };

export default async function QueuePage() {
  await pageMe();
  return <QueueView />;
}
