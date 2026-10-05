import { SettingsPage } from "../../settings-ui";
import AppearanceSection from "../appearance-section";

export const metadata = { title: "Appearance · Settings" };

export default function AppearancePage() {
  return (
    <SettingsPage title="Appearance" subtitle="How the dashboard looks">
      <AppearanceSection />
    </SettingsPage>
  );
}
