// The app icon's art, shared by /icon and /apple-icon: a full-bleed brand-orange square with a near-black "P", no
// rounded corners or shadow baked in (iOS applies its own mask, applebrandkit.md 8).
export function Glyph({ size }: { size: number }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ff6600", color: "#1a0d00", fontSize: size * 0.58, fontWeight: 700, fontFamily: "sans-serif" }}>
      r
    </div>
  );
}
