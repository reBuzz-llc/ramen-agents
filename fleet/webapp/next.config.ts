import type { NextConfig } from "next";
import { REMOVED_ROUTES } from "./lib/removed-routes";

const nextConfig: NextConfig = {
  // Lets `npm run dev` be opened through tailscale serve too; production (`npm start`) needs no entry.
  allowedDevOrigins: ["*.ts.net", "**.ts.net"],
  // scripts/deploy.sh builds into a staging folder while the live dashboard keeps serving .next, so a build in
  // progress -- or one that fails -- never takes the dashboard down.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The removed pages (owner, 2026-10-30) send old links home, not to a 404. Not permanent: a browser must not cache it.
  async redirects() {
    return REMOVED_ROUTES.map((source) => ({ source, destination: "/", permanent: false }));
  },
};

export default nextConfig;
