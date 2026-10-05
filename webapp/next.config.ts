import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets `npm run dev` be opened through tailscale serve too; production (`npm start`) needs no entry.
  allowedDevOrigins: ["*.ts.net", "**.ts.net"],
};

export default nextConfig;
