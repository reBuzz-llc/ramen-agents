import { SectionRow, SETTINGS_SECTIONS, SettingsPage } from "../settings-ui";
import AppearanceSection from "./appearance-section";

// Phones: the list of sections. Wide screens: the sidebar is already the list, so show Appearance.
export default function SettingsIndex() {
  return (
    <>
      <div className="lg:hidden">
        <SettingsPage title="Settings" subtitle="For this dashboard and your bots">
          <div className="space-y-0.5 rounded-xl bg-panel p-1.5">
            {SETTINGS_SECTIONS.map((s) => (
              <SectionRow key={s.href} section={s} />
            ))}
          </div>
        </SettingsPage>
      </div>
      <div className="hidden lg:block">
        <SettingsPage title="Appearance" subtitle="How the dashboard looks">
          <AppearanceSection />
        </SettingsPage>
      </div>
    </>
  );
}
