import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Pin the workspace root so Next doesn't climb past the monorepo when it infers
// output-file-tracing (it otherwise trips over unrelated lockfiles in $HOME).
const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(appDir, "..", "..");

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@quagga/ui", "@quagga/types", "@quagga/core"],
  turbopack: { root: repoRoot },
};

export default config;
