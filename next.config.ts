import type { NextConfig } from "next";
import { REMEMBER_SECONDS } from "./lib/page-memory";

const nextConfig: NextConfig = {
  // PGlite ships its own WebAssembly Postgres; keep it out of the server bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
  // A visited page opens at once for a short while; app/fresh-pages.tsx keeps it honest.
  experimental: { staleTimes: { dynamic: REMEMBER_SECONDS } },
};

export default nextConfig;
