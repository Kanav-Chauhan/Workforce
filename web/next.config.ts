import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = dirname(fileURLToPath(import.meta.url));

// Built to static files (web/out); the Workforce server serves them on its own port.
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  devIndicators: false,
  // The repo root, so the dashboard can import ../shared.
  turbopack: { root: join(here, "..") },
};

export default config;
