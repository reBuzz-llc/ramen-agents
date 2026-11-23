import { currentIdentity } from "@/lib/identity";
import SettingsShell from "../settings-shell";

export const metadata = { title: "Settings · Bot Dashboard" };

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <SettingsShell identity={await currentIdentity()}>
      {children}
    </SettingsShell>
  );
}
