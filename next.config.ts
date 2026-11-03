import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships its own WebAssembly Postgres; keep it out of the server bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
