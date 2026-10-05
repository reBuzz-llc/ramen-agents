import { SettingsPage } from "../../settings-ui";
import NotificationsView from "./notifications-view";

export const metadata = { title: "Notifications · Settings" };

export default function NotificationsPage() {
  return (
    <SettingsPage title="Notifications" subtitle="Alerts from your bots">
      <NotificationsView />
    </SettingsPage>
  );
}
