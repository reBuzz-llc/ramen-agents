import { Panel } from "../ui";
import { ThemeCards } from "../theme-picker";
import GlassSlider from "../glass-slider";

export default function AppearanceSection() {
  return (
    <>
      <Panel title="Theme" hint="Automatic follows your iPhone, iPad or Mac. The choice is saved in this browser.">
        <ThemeCards />
      </Panel>
      <Panel title="Liquid Glass" hint="How see-through the toolbar, tab bar and menus are. Clear shows more of the page behind; tinted reads more easily.">
        <GlassSlider />
      </Panel>
      <Panel title="Accessibility" hint="The dashboard also follows these system settings on its own.">
        <ul className="divide-y divide-line text-sm">
          {[
            ["Increase Contrast", "Stronger colors, darker separators, near-solid glass"],
            ["Reduce Transparency", "Solid bars instead of glass"],
            ["Reduce Motion", "No springs or scaling"],
            ["Larger Text (iPhone and iPad)", "Text scales with your Text Size setting"],
          ].map(([name, what]) => (
            <li key={name} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
              <span className="font-medium text-ink">{name}</span>
              <span className="text-muted">{what}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
