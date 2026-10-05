// The app icon, drawn once for every size. A full-bleed square: iOS applies its own rounded mask and
// Liquid Glass lighting, so the art must not bake in corners or shadows.
export function AppIconArt({ size }: { size: number }) {
  const u = size / 100;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(160deg, #5ac8fa 0%, #0088ff 45%, #6155f5 100%)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: 4 * u, height: 9 * u, background: "rgba(255,255,255,0.92)", borderRadius: 2 * u }} />
        <div style={{ width: 11 * u, height: 11 * u, marginTop: -3 * u, background: "rgba(255,255,255,0.92)", borderRadius: 6 * u }} />
        <div
          style={{
            marginTop: 3 * u,
            width: 56 * u,
            height: 40 * u,
            borderRadius: 16 * u,
            background: "rgba(255,255,255,0.95)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12 * u,
          }}
        >
          <div style={{ width: 9 * u, height: 12 * u, borderRadius: 5 * u, background: "#0a3d91" }} />
          <div style={{ width: 9 * u, height: 12 * u, borderRadius: 5 * u, background: "#0a3d91" }} />
        </div>
      </div>
    </div>
  );
}
