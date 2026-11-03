// Add to Home Screen (applebrandkit.md 8): Peek opens on its own, without Safari's bars, at the clock.
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ramen-agents",
    short_name: "ramen",
    description: "One queue: agents fill it, people finish it.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f7",
    theme_color: "#faf9f7",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
